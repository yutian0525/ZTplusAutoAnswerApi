// ==UserScript==
// @name         自动答题助手（ZTplus专用）
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  自动从题库查询答案并选择（支持判断题、单选题、多选题的批量处理）
// @author       Claude
// @match        *://www.ztplus.cn/pc/index.html*
// @match        *://ztplus.cn/pc/index.html*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SERVER_URL: 'http://localhost:5000/query',
        ANSWER_DELAY_MIN: 300,
        ANSWER_DELAY_MAX: 600,
    };

    let isRunning = false;
    let answeredCount = 0;
    let totalQuestions = 0;

    // ----------------------------------------------------------------
    // 控制面板
    // ----------------------------------------------------------------
    function createControlPanel() {
        if (document.getElementById('zt-auto-answer-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'zt-auto-answer-panel';
        panel.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 280px;
            background: rgba(255,255,255,0.97); border: 2px solid #1890ff;
            border-radius: 10px; padding: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
            font-family: Arial, sans-serif; font-size: 13px; z-index: 99999;
        `;
        panel.innerHTML = `
            <div style="font-weight:bold;font-size:15px;color:#1890ff;margin-bottom:10px;text-align:center;">
                自动答题助手
            </div>
            <div id="zt-status" style="margin-bottom:8px;padding:6px 8px;background:#f0f7ff;border-radius:5px;font-size:12px;color:#333;">
                状态：等待开始
            </div>
            <div id="zt-progress" style="margin-bottom:10px;font-size:12px;color:#555;">
                进度：0 / 0
            </div>
            <div style="display:flex;gap:8px;">
                <button id="zt-start" style="flex:1;padding:7px;background:#52c41a;color:#fff;border:none;border-radius:5px;cursor:pointer;">
                    开始答题
                </button>
                <button id="zt-stop" style="flex:1;padding:7px;background:#ff4d4f;color:#fff;border:none;border-radius:5px;cursor:pointer;" disabled>
                    停止
                </button>
            </div>
        `;
        document.body.appendChild(panel);
        document.getElementById('zt-start').onclick = startAutoAnswer;
        document.getElementById('zt-stop').onclick = stopAutoAnswer;
    }

    function setStatus(text) {
        const el = document.getElementById('zt-status');
        if (el) el.textContent = '状态：' + text;
    }

    function setProgress(current, total) {
        const el = document.getElementById('zt-progress');
        if (el) el.textContent = `进度：${current} / ${total}`;
    }

    // ----------------------------------------------------------------
    // 解析页面题目
    // ----------------------------------------------------------------
    function getAllQuestions() {
        // 优先带 data-v 的精确选择器，回退到纯 class 选择器
        let containers = document.querySelectorAll('.sub-content[data-v-a98933d6]');
        if (containers.length === 0) {
            containers = document.querySelectorAll('.sub-content');
        }

        const questions = [];
        containers.forEach((el, idx) => {
            try {
                // 题目文本
                const qp = el.querySelector('p[id^="question_"]');
                if (!qp) return;
                let text = qp.textContent.trim().replace(/^\d+\.\s*/, '');

                // 题型（判断题 / 单选题 / 多选题）
                const typeEl = el.querySelector('.quer-type');
                const typeText = typeEl ? typeEl.textContent.trim() : '';

                // 单选（包括判断题）
                const radioLabels = el.querySelectorAll('label.el-radio');
                // 多选
                const checkboxLabels = el.querySelectorAll('label.el-checkbox');

                let questionType, labels, options;

                if (checkboxLabels.length > 0) {
                    questionType = 'checkbox';
                    labels = Array.from(checkboxLabels);
                } else if (radioLabels.length > 0) {
                    questionType = 'radio';
                    labels = Array.from(radioLabels);
                } else {
                    return; // 无法识别，跳过
                }

                // 提取选项字母，格式如 "A、正确" → 'A'
                options = labels.map(lbl => {
                    const labelSpan = lbl.querySelector('.el-radio__label, .el-checkbox__label');
                    return labelSpan ? labelSpan.textContent.trim() : '';
                });

                questions.push({
                    index: idx + 1,
                    element: el,
                    questionText: text,
                    questionType,
                    typeText,
                    options,   // ["A、正确", "B、错误", ...]
                    labels,    // label.el-radio / label.el-checkbox 元素列表（用于点击）
                });

                console.log(`[AutoAnswer] Q${idx + 1} (${typeText || questionType}): ${text.slice(0, 40)}...`);
            } catch (e) {
                console.error('[AutoAnswer] 解析题目出错:', e);
            }
        });

        return questions;
    }

    // ----------------------------------------------------------------
    // 查询题库
    // ----------------------------------------------------------------
    function queryQuestionBank(questionText) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${CONFIG.SERVER_URL}?term=${encodeURIComponent(questionText)}`,
                timeout: 6000,
                onload(res) {
                    try {
                        if (res.status === 200) {
                            const data = JSON.parse(res.responseText);
                            if (data && data.length > 0) {
                                resolve(data[0].correct_answer);
                                return;
                            }
                        }
                    } catch (_) {}
                    resolve(null);
                },
                onerror()   { resolve(null); },
                ontimeout() { resolve(null); },
            });
        });
    }

    // ----------------------------------------------------------------
    // 点击 Element UI 标签（单选 / 多选）
    //   answer 示例: "A", "B", "正确", "错误", "ABC", "BD"
    // ----------------------------------------------------------------
    function selectAnswer(question, answer) {
        if (!answer) {
            console.warn(`[AutoAnswer] Q${question.index} 无答案，跳过`);
            return false;
        }

        if (question.questionType === 'radio') {
            return clickRadioLabel(question, answer);
        } else {
            return clickCheckboxLabels(question, answer);
        }
    }

    /**
     * 将答案字符串映射到 label 索引
     * options 格式: ["A、正确", "B、错误", "C、...", ...]
     */
    function answerToIndex(options, answer) {
        const ans = answer.trim();

        // 直接字母匹配 A/B/C/D
        const letterMap = { A: 0, B: 1, C: 2, D: 3, E: 4 };
        if (letterMap[ans] !== undefined && letterMap[ans] < options.length) {
            return letterMap[ans];
        }

        // "正确" / "错误" 快捷匹配
        if (ans === '正确' || ans === 'true' || ans === '对') return 0;
        if (ans === '错误' || ans === 'false' || ans === '错') return 1;

        // 全文本模糊匹配
        for (let i = 0; i < options.length; i++) {
            if (options[i].includes(ans) || ans.includes(options[i])) return i;
        }

        return -1; // 未找到
    }

    function clickRadioLabel(question, answer) {
        const idx = answerToIndex(question.options, answer);
        const targetIdx = idx >= 0 ? idx : 0;

        const label = question.labels[targetIdx];
        if (!label) return false;

        // 先尝试点击 label，再尝试点击内部的 el-radio__inner span
        label.click();

        // 补充触发 Vue input 事件
        const input = label.querySelector('input');
        if (input) {
            input.dispatchEvent(new Event('input',  { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        console.log(`[AutoAnswer] Q${question.index} 选择: ${question.options[targetIdx]} (答案: ${answer})`);
        return true;
    }

    function clickCheckboxLabels(question, answer) {
        // 先取消所有已选
        question.labels.forEach(lbl => {
            const input = lbl.querySelector('input');
            if (input && input.checked) lbl.click();
        });

        // 解析多选答案字母列表，如 "ABC" → ['A','B','C']
        let letters = [];
        if (/^[A-Z]+$/.test(answer.trim())) {
            letters = answer.trim().split('');
        } else {
            // 尝试当作单字母
            letters = [answer.trim()];
        }

        let success = 0;
        letters.forEach(letter => {
            const idx = answerToIndex(question.options, letter);
            if (idx < 0 || idx >= question.labels.length) return;

            const label = question.labels[idx];
            label.click();
            const input = label.querySelector('input');
            if (input) {
                input.dispatchEvent(new Event('input',  { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            success++;
        });

        console.log(`[AutoAnswer] Q${question.index} 多选: ${answer}, 选中 ${success} 项`);
        return success > 0;
    }

    // ----------------------------------------------------------------
    // 主流程
    // ----------------------------------------------------------------
    function randomDelay() {
        const ms = Math.random() * (CONFIG.ANSWER_DELAY_MAX - CONFIG.ANSWER_DELAY_MIN) + CONFIG.ANSWER_DELAY_MIN;
        return new Promise(r => setTimeout(r, ms));
    }

    async function startAutoAnswer() {
        if (isRunning) return;
        isRunning = true;
        answeredCount = 0;

        document.getElementById('zt-start').disabled = true;
        document.getElementById('zt-stop').disabled = false;

        setStatus('扫描题目中...');

        const questions = getAllQuestions();
        totalQuestions = questions.length;

        if (totalQuestions === 0) {
            setStatus('未找到题目，请确认页面已加载完毕');
            stopAutoAnswer();
            return;
        }

        setStatus(`找到 ${totalQuestions} 题，开始作答...`);

        for (let i = 0; i < questions.length; i++) {
            if (!isRunning) break;

            const q = questions[i];
            setProgress(i + 1, totalQuestions);
            setStatus(`第 ${i + 1} 题：查询答案...`);

            q.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await randomDelay();

            if (!isRunning) break;

            const answer = await queryQuestionBank(q.questionText);
            if (!isRunning) break;

            if (answer) {
                selectAnswer(q, answer);
                answeredCount++;
                setStatus(`第 ${i + 1} 题：已作答 (${answer})`);
            } else {
                setStatus(`第 ${i + 1} 题：题库未收录，已跳过`);
            }

            if (i < questions.length - 1) await randomDelay();
        }

        if (isRunning) {
            setStatus(`完成！共 ${totalQuestions} 题，已答 ${answeredCount} 题`);
            setProgress(totalQuestions, totalQuestions);
        }

        stopAutoAnswer();
    }

    function stopAutoAnswer() {
        isRunning = false;
        const startBtn = document.getElementById('zt-start');
        const stopBtn  = document.getElementById('zt-stop');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn)  stopBtn.disabled  = true;
    }

    // ----------------------------------------------------------------
    // 初始化
    // ----------------------------------------------------------------
    function isTestPage() {
        return window.location.hash.includes('/paper/testing/');
    }

    function init() {
        if (!isTestPage()) return;
        console.log('[AutoAnswer] 检测到答题页面，初始化...');
        setTimeout(createControlPanel, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Vue SPA 路由切换时重新检测
    let lastHash = location.hash;
    setInterval(() => {
        if (location.hash !== lastHash) {
            lastHash = location.hash;
            if (isTestPage()) setTimeout(createControlPanel, 2000);
        }
    }, 1000);

})();
