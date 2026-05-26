// ==UserScript==
// @name         自动答题助手（练习题专用）
// @namespace    http://tampermonkey.net/
// @version      0.9.0
// @description  自动选择答案（默认选A），支持判断题、单选题和多选题，可收集题目和答案并导出JSON
// @author       Copilot
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    let running = true; // For main auto-answer/pause toggle
    let isCollectingByDefault = true; // Default to collecting
    let collectedQuestions = [];
    let questionNumbersCollected = new Set();    const STORAGE_KEY_COLLECTED_QUESTIONS = 'collectedQuestionsData_v2_json';
    const STORAGE_KEY_COLLECTED_NUMBERS = 'collectedQuestionNumbers_v2_json';

    // Load collected data from GM storage on startup
    function loadCollectedData() {
        const storedQuestions = GM_getValue(STORAGE_KEY_COLLECTED_QUESTIONS);
        const storedNumbers = GM_getValue(STORAGE_KEY_COLLECTED_NUMBERS);
        if (storedQuestions) {
            try {
                collectedQuestions = JSON.parse(storedQuestions);
                // Ensure it's an array of objects with expected properties
                if (!Array.isArray(collectedQuestions) || !collectedQuestions.every(q => q && typeof q.questionText === 'string' && typeof q.correctAnswer === 'string')) {
                    console.warn("Loaded data is not in the expected JSON format. Resetting.");
                    collectedQuestions = [];
                }
            } catch (e) {
                console.error("Error parsing stored questions, resetting:", e);
                collectedQuestions = [];
            }
        }
        if (storedNumbers) {
            try {
                questionNumbersCollected = new Set(JSON.parse(storedNumbers));
            } catch (e) {
                console.error("Error parsing stored question numbers, resetting:", e);
                questionNumbersCollected = new Set();
            }
        }
        console.log(`Loaded ${collectedQuestions.length} questions from storage (JSON format).`);
    }

    // Save collected data to GM storage
    function saveCollectedData() {
        // Filter data to save only questionText and correctAnswer
        const dataToSave = collectedQuestions.map(q => ({
            questionNumber: q.questionNumber, // Keep number for sorting and identification
            questionText: q.questionText,
            correctAnswer: q.correctAnswer
        }));
        GM_setValue(STORAGE_KEY_COLLECTED_QUESTIONS, JSON.stringify(dataToSave));
        GM_setValue(STORAGE_KEY_COLLECTED_NUMBERS, JSON.stringify(Array.from(questionNumbersCollected)));
        console.log(`Saved ${dataToSave.length} questions to storage (JSON format - text & answer only).`);
    }
    
    // Function to clear stored data (for testing or reset)
    function clearStoredData() {
        GM_deleteValue(STORAGE_KEY_COLLECTED_QUESTIONS);
        GM_deleteValue(STORAGE_KEY_COLLECTED_NUMBERS);
        collectedQuestions = [];
        questionNumbersCollected = new Set();
        console.log("Cleared stored question data.");
        updateCollectionStatusDisplay();
    }


    // --- Panel Functions ---
    function createPanel() {
        if (document.getElementById('auto-answer-panel')) return;

        let panel = document.createElement('div');
        panel.id = 'auto-answer-panel';
        // ... (panel styling - kept from previous version) ...
        panel.style.position = 'fixed';
        panel.style.right = '30px';
        panel.style.bottom = '30px';
        panel.style.zIndex = '9999';
        panel.style.background = 'rgba(255,255,255,0.95)';
        panel.style.border = '1px solid #aaa';
        panel.style.borderRadius = '8px';
        panel.style.padding = '12px 18px';
        panel.style.boxShadow = '0 2px 8px #888';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '14px';

        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:8px; font-size:16px; color:#333;">答题助手</div>
            <div id="auto-answer-status" style="margin-bottom:8px; color:#555;">正在初始化...</div>
            <button id="auto-answer-toggle" style="padding: 6px 12px; border:1px solid #ccc; border-radius:4px; background-color:#f0f0f0; cursor:pointer; margin-bottom: 5px;">${running ? '暂停答题' : '继续答题'}</button>
            <hr style="margin: 8px 0;">
            <div style="font-weight:bold; margin-bottom:4px; font-size:15px; color:#333;">题库收集 (默认开启)</div>
            <div id="collection-status" style="margin-bottom:8px; font-size:13px; color:#555;">未开始</div>
            <button id="auto-collect-export" style="padding: 6px 10px; border:1px solid #ccc; border-radius:4px; background-color:#f0f0f0; cursor:pointer; margin-left:0px;" disabled>导出题库 (0)</button>
            <button id="clear-storage-button" title="清除已存储的题库数据" style="padding: 3px 6px; font-size:10px; border:1px solid #f00; color:#f00; border-radius:4px; background-color:#fee; cursor:pointer; margin-left:5px; vertical-align:middle;">清缓存</button>
        `;
        document.body.appendChild(panel);

        document.getElementById('auto-answer-toggle').onclick = function() {
            running = !running;
            this.innerText = running ? '暂停答题' : '继续答题';
            if (running) {
                console.log('答题助手已继续 (主控制)');
                mainLoop();
            } else {
                console.log('答题助手已暂停 (主控制)');
            }
        };

        // Removed the toggleCollection button, collection is now always on if 'running'
        document.getElementById('auto-collect-export').onclick = exportCollectedQuestions;
        document.getElementById('clear-storage-button').onclick = clearStoredData;

    }

    function updatePanelStatus(message) {
        const statusEl = document.getElementById('auto-answer-status');
        if (statusEl) statusEl.innerText = message;
    }

    function updateCollectionStatusDisplay() {
        const statusEl = document.getElementById('collection-status');
        const exportButton = document.getElementById('auto-collect-export');
        if (statusEl) {
            // Simplified status as collection is always on (when script is running)
            statusEl.innerText = `已收集 ${collectedQuestions.length} 题`;
        }
        if (exportButton) {
            exportButton.innerText = `导出题库 (${collectedQuestions.length})`;
            exportButton.disabled = collectedQuestions.length === 0;
        }
    }

    // --- Action Functions (for auto-answering) ---
    function getStats() {
        let total = 0, correct = 0, error = 0;
        const titleDiv = document.querySelector('.answer-card .title');
        if (titleDiv) {
            const spans = titleDiv.querySelectorAll('span');
            if (spans.length > 0 && spans[0].innerText.includes('共')) {
                total = parseInt(spans[0].innerText.replace(/\D/g, '')) || 0;
            }
            if (spans.length > 1 && spans[1].innerText.includes('答对')) {
                correct = parseInt(spans[1].innerText.replace(/\D/g, '')) || 0;
            }
            if (spans.length > 2 && spans[2].innerText.includes('答错')) {
                error = parseInt(spans[2].innerText.replace(/\D/g, '')) || 0;
            }
        }
        return { total, correct, error };
    }

    // NEW: Function to get current question text
    function getCurrentQuestionText() {
        const questionContent = document.querySelector('.question-content');
        if (!questionContent) {
            console.warn("[getCurrentQuestionText] Question content area not found.");
            return null;
        }
        const titleElement = questionContent.querySelector('p.title');
        if (!titleElement) {
            console.warn("[getCurrentQuestionText] Question title element not found.");
            return null;
        }
        const titleElementClone = titleElement.cloneNode(true);
        const typeElementInClone = titleElementClone.querySelector('span.type'); // e.g., 【多选题】
        if (typeElementInClone) typeElementInClone.remove();
        
        // Remove question number like "1、 " or "1. "
        let questionText = titleElementClone.innerText.replace(/^[\d]+\s*[、.]\s*/, '').trim();
        return questionText;
    }    // Function to select the best available option (prioritizing A, supporting different question types)
    function selectBestOption() {
        // Check for radio buttons (single choice: 判断题, 单选题)
        const radioLabels = document.querySelectorAll('.question-content .el-radio-group label.el-radio');
        if (radioLabels.length > 0) {
            return selectFirstRadioOption(radioLabels);
        }

        // Check for checkboxes (multiple choice: 多选题) - future expansion
        const checkboxLabels = document.querySelectorAll('.question-content .el-checkbox-group label.el-checkbox');
        if (checkboxLabels.length > 0) {
            return selectFirstCheckboxOption(checkboxLabels);
        }

        console.warn('[selectBestOption] No selectable options found (neither radio nor checkbox).');
        return false;
    }

    // Function to select the first radio option (A option for 判断题/单选题)
    function selectFirstRadioOption(labels) {
        if (labels.length === 0) {
            console.warn('[selectFirstRadioOption] No radio option labels found.');
            return false;
        }

        // Try to select the first option (index 0) - typically "A" or "正确"
        const firstLabel = labels[0];
        const firstInput = firstLabel.querySelector('input[type="radio"].el-radio__original');
        const firstLabelTextElement = firstLabel.querySelector('.el-radio__label');
        const firstLabelText = firstLabelTextElement ? firstLabelTextElement.innerText.trim() : "Option @ Index 0";

        if (firstInput && !firstInput.disabled && !firstLabel.classList.contains('is-disabled') && !firstInput.checked && firstLabel.offsetParent !== null) {
            firstLabel.click();
            console.log(`[selectFirstRadioOption] Selected the first radio option (A): "${firstLabelText}"`);
            return true;
        } else {
            console.warn(`[selectFirstRadioOption] First option "${firstLabelText}" is not selectable. Trying fallback.`);
            // Fallback: try any other available option
            for (let i = 1; i < labels.length; i++) {
                const label = labels[i];
                const currentInput = label.querySelector('input[type="radio"].el-radio__original');
                const currentLabelTextElement = label.querySelector('.el-radio__label');
                const currentLabelText = currentLabelTextElement ? currentLabelTextElement.innerText.trim() : `Option @ Index ${i}`;

                if (currentInput && !currentInput.disabled && !label.classList.contains('is-disabled') && !currentInput.checked && label.offsetParent !== null) {
                    label.click();
                    console.log(`[selectFirstRadioOption] Selected fallback option at index ${i}: "${currentLabelText}"`);
                    return true;
                }
            }
        }
        console.warn('[selectFirstRadioOption] No selectable radio option found.');
        return false;
    }

    // Function to select the first checkbox option (for future 多选题 support)
    function selectFirstCheckboxOption(labels) {
        if (labels.length === 0) {
            console.warn('[selectFirstCheckboxOption] No checkbox option labels found.');
            return false;
        }

        // For multiple choice questions, select the first option (A)
        const firstLabel = labels[0];
        const firstInput = firstLabel.querySelector('input[type="checkbox"].el-checkbox__original');
        const firstLabelTextElement = firstLabel.querySelector('.el-checkbox__label');
        const firstLabelText = firstLabelTextElement ? firstLabelTextElement.innerText.trim() : "Option @ Index 0";

        if (firstInput && !firstInput.disabled && !firstLabel.classList.contains('is-disabled') && firstLabel.offsetParent !== null) {
            if (!firstInput.checked) {
                firstLabel.click();
                console.log(`[selectFirstCheckboxOption] Selected the first checkbox option (A): "${firstLabelText}"`);
                return true;
            } else {
                console.log(`[selectFirstCheckboxOption] First checkbox option "${firstLabelText}" is already selected.`);
                return true; // Already selected counts as success
            }
        } else {
            console.warn(`[selectFirstCheckboxOption] First checkbox option "${firstLabelText}" is not selectable.`);
            return false;
        }
    }

    function clickConfirmButton() {
        const confirmButton = document.querySelector('.question-content .btn button.el-button');
        // console.log('[clickConfirmButton] Checking for confirm button...');
        if (confirmButton && confirmButton.offsetParent !== null && !confirmButton.disabled && !confirmButton.classList.contains('is-disabled')) {
            // console.log('  => Attempting to click Confirm button.');
            confirmButton.click();
            return true;
        }
        // console.log('  - Confirm button not found or not clickable.');
        return false;
    }


    // --- Shared Action Functions ---
    function clickNext() {
        const nextLink = document.querySelector('.question-content .tool .next a');
        // console.log('[clickNext] Checking for "Next" button...');
        if (nextLink && nextLink.offsetParent !== null && nextLink.innerText.includes('下一题')) {
            // console.log('  => Attempting to click "Next" button. Link text:', nextLink.innerText);
            nextLink.click();
            return true;
        }
        // console.log('  - "Next" button not found or not visible/matching.');
        return false;
    }

    function isFinished() {
        const nextLink = document.querySelector('.question-content .tool .next a');
        const questionContent = document.querySelector('.question-content');

        if (!questionContent) {
            // console.log('[isFinished] No question content area. Assuming not on an active question page or page is not fully loaded.');
            const stats = getStats();
            if (stats.total > 0 && (stats.correct + stats.error >= stats.total)) {
                // console.log('[isFinished] Stats indicate completion and no question content area. FINISHED.');
                return true;
            }
            // console.log('[isFinished] No question content area, and stats do not indicate completion. NOT FINISHED.');
            return false;
        }

        let nextButtonFoundAndVisible = (nextLink && nextLink.offsetParent !== null && nextLink.innerText.includes('下一题'));
        // const style = nextLink ? getComputedStyle(nextLink).display : 'not found in DOM';
        // console.log(`[isFinished] "Next" button query: ${nextLink ? 'found' : 'not found'}. Visible: ${nextButtonFoundAndVisible}. Style: ${style}.`);

        if (!nextButtonFoundAndVisible) {
            const stats = getStats();
            if (stats.total > 0 && (stats.correct + stats.error >= stats.total)) {
                //  console.log('[isFinished] "Next" button not actionable, but stats indicate completion. FINISHED.');
                 return true;
            }
            // console.log('[isFinished] "Next" button not actionable, stats incomplete. NOT FINISHED.');
            return false;
        }
        // console.log('[isFinished] "Next" button is actionable. NOT FINISHED.');
        return false;
    }

    // --- Collection Functions ---
    function extractQuestionData() {
        const questionContent = document.querySelector('.question-content');
        if (!questionContent) {
            console.warn("[extractQuestionData] Question content area not found.");
            return null;
        }

        const titleElement = questionContent.querySelector('p.title');
        if (!titleElement) {
            console.warn("[extractQuestionData] Question title element not found.");
            return null;
        }

        const titleElementClone = titleElement.cloneNode(true);
        const typeElementInClone = titleElementClone.querySelector('span.type');
        // const questionType = typeElementInClone ? typeElementInClone.innerText.trim() : '未知题型'; // Not saving type anymore
        if (typeElementInClone) typeElementInClone.remove();

        let fullTitleText = titleElement.innerText.trim();
        let questionNumberText = fullTitleText.split('、')[0].trim();
        let questionNumber = parseInt(questionNumberText);

        if (isNaN(questionNumber)) {
            console.warn("[extractQuestionData] Could not parse question number from:", fullTitleText);
            const numMatch = fullTitleText.match(/^(\d+)/);
            if (numMatch) questionNumber = parseInt(numMatch[1]);
            else {
                 console.error("Failed to get question number definitively.");
                 return null;
            }
        }
        
        let questionText = titleElementClone.innerText.replace(/^[\d]+\s*、\s*/, '').trim();

        // Options are not saved in the new JSON format
        // const options = [];
        // const optionLabels = questionContent.querySelectorAll('.el-radio-group label.el-radio .el-radio__label');
        // optionLabels.forEach(label => {
        //     options.push(label.innerText.trim());
        // });

        const answerContainer = questionContent.querySelector('.tool .answer');
        if (!answerContainer || answerContainer.offsetParent === null || getComputedStyle(answerContainer).display === 'none') {
            console.log("[extractQuestionData] Answer not yet visible. Will retry collection after action.");
            return null; 
        }
        const correctAnswerElement = answerContainer.querySelector('.text');
        const correctAnswer = correctAnswerElement ? correctAnswerElement.innerText.trim() : '未知';
        
        if (correctAnswer === '未知' && correctAnswerElement) {
             console.warn(`[extractQuestionData] Correct answer element found, but text is '未知' or empty. HTML: ${correctAnswerElement.outerHTML}`);
        } else if (correctAnswer === '未知') {
            console.warn(`[extractQuestionData] Correct answer element NOT found or text is '未知'.`);
        }

        console.log(`[extractQuestionData] Extracted Q${questionNumber} - Correct Answer: ${correctAnswer}`);
        // Return only questionText and correctAnswer, plus number for internal use
        return { questionNumber, questionText, correctAnswer }; 
    }

    // Removed formatToMarkdown as we are exporting JSON now

    function exportCollectedQuestions() {
        if (collectedQuestions.length === 0) {
            alert('没有收集到任何题目！');
            return;
        }

        // Prepare data for export: only questionText and correctAnswer, sorted by questionNumber
        const exportData = collectedQuestions
            .sort((a, b) => a.questionNumber - b.questionNumber)
            .map(q => ({ 
                question: q.questionText, 
                answer: q.correctAnswer 
            }));

        const jsonContent = JSON.stringify(exportData, null, 2); // Pretty print JSON
        const filename = `题库导出_${new Date().toISOString().slice(0,10)}.json`;
        const element = document.createElement('a');
        element.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonContent));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        console.log(`题库已导出为 ${filename} (JSON format)`);
        updateCollectionStatusDisplay();
    }


    // --- Main Logic ---
    async function mainLoop() {
        if (!running) {
            console.log('[mainLoop] Paused (master toggle).');
            return;
        }

        const stats = getStats();
        updatePanelStatus(`共${stats.total} | 对:${stats.correct} | 错:${stats.error}`);

        if (isFinished()) {
            updatePanelStatus(`完成! 共${stats.total} | 对:${stats.correct} | 错:${stats.error}`);
            console.log('[mainLoop] Quiz finished or stuck. Halting automatic actions.');
            saveCollectedData(); // Save any remaining data when quiz finishes
            return;
        }        let optionSelected = false;
        const currentQuestionText = getCurrentQuestionText();

        if (currentQuestionText) {
            console.log(`[mainLoop] Current question: "${currentQuestionText}"`);
        } else {
            console.warn("[mainLoop] Could not extract current question text. Will attempt selection anyway.");
        }        // Always try to select the best option (prioritizing A)
        console.log("[mainLoop] Attempting to select the best available option (defaulting to A).");
        optionSelected = selectBestOption();

        if (optionSelected) {
            console.log("[mainLoop] An option was selected. Proceeding to confirm and next.");
            setTimeout(() => {
                clickConfirmButton();
                setTimeout(() => {
                    // Attempt to collect data AFTER confirm (when answer is shown)
                    if (isCollectingByDefault) {
                        const currentQData = extractQuestionData(); // This now returns { questionNumber, questionText, correctAnswer }
                        if (currentQData && currentQData.questionNumber && !questionNumbersCollected.has(currentQData.questionNumber)) {
                            if (currentQData.correctAnswer && currentQData.correctAnswer !== '未知') {
                                collectedQuestions.push(currentQData);
                                questionNumbersCollected.add(currentQData.questionNumber);
                                console.log(`Collected question #${currentQData.questionNumber}. Total collected: ${collectedQuestions.length}`);
                                saveCollectedData(); // Save after each successful collection
                            } else {
                                console.warn(`Question #${currentQData.questionNumber} - Correct answer not found or '未知' post-confirmation. Not collected.`);
                            }
                        } else if (currentQData && currentQData.questionNumber && questionNumbersCollected.has(currentQData.questionNumber)) {
                            // console.log(`Question #${currentQData.questionNumber} already collected or data issue post-confirmation.`);
                        } else if (!currentQData || !currentQData.questionNumber) {
                            console.warn("Failed to extract question data (or question number) for collection after confirm (answer might not be visible yet or page structure changed).");
                        }
                        updateCollectionStatusDisplay();
                    }

                    if (!clickNext()) {
                        console.log("[mainLoop] Next button wasn't immediately available after confirm/collection. Will retry loop.");
                    }
                    setTimeout(mainLoop, 150); // Next iteration
                }, 80); // Delay for answer to appear and collection
            }, 50); // Delay after option selection
        } else {
            // No option was selected (neither from bank nor fallback)
            console.warn("[mainLoop] No option could be selected at all. Retrying loop with longer delay.");
            setTimeout(mainLoop, 2500); // Retry loop
        }
    }

    // --- Initialization ---
    loadCollectedData();
    createPanel();
    updateCollectionStatusDisplay();

    // --- Auto-start logic (if needed) ---
    // mainLoop(); // Uncomment to start automatically
})();