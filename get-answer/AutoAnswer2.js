// ==UserScript==
// @name         自动答题助手（ZTplus · ncre3）
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  根据题干查询题库，按返回的选项文字自动选择答案
// @author       Claude
// @match        *://www.ztplus.cn/pc/index.html*
// @match        *://ztplus.cn/pc/index.html*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_HOST = "localhost:5011";
  const DELAY_MIN = 300;
  const DELAY_MAX = 600;

  let isRunning = false;
  let answeredCount = 0;
  let totalQuestions = 0;

  // ----------------------------------------------------------------
  // 工具
  // ----------------------------------------------------------------
  function getServerUrl() {
    const host = (
      document.getElementById("zt-host-input")?.value || DEFAULT_HOST
    ).trim();
    return `http://${host}/query`;
  }

  function delay() {
    const ms = Math.random() * (DELAY_MAX - DELAY_MIN) + DELAY_MIN;
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 清洗题干：去除题号、（  ）占位符、多余空白 */
  function cleanStem(text) {
    return text
      .trim()
      .replace(/^\d+[.、]\s*/, "")
      .replace(/（\s+）/g, "（）")
      .replace(/\(\s+\)/g, "()")
      .replace(/\s+/g, " ");
  }

  // ----------------------------------------------------------------
  // 控制面板
  // ----------------------------------------------------------------
  let panelMinimized = false;

  function createPanel() {
    if (document.getElementById("zt-panel")) return;

    const savedHost = GM_getValue("serverHost", DEFAULT_HOST);

    const panel = document.createElement("div");
    panel.id = "zt-panel";
    panel.style.cssText = `
            position:fixed; top:20px; right:20px; width:300px;
            background:rgba(255,255,255,0.97); border:2px solid #1890ff;
            border-radius:10px; padding:0;
            box-shadow:0 4px 16px rgba(0,0,0,0.18);
            font-family:Arial,sans-serif; font-size:13px; z-index:99999;
            overflow:hidden;
        `;
    panel.innerHTML = `
            <!-- 标题栏（始终可见） -->
            <div id="zt-titlebar" style="
                display:flex; align-items:center; justify-content:space-between;
                padding:9px 12px; background:#1890ff; cursor:default;
            ">
                <span style="font-weight:bold;font-size:14px;color:#fff;">自动答题助手</span>
                <button id="zt-toggle" title="最小化 / 还原" style="
                    background:none; border:1px solid rgba(255,255,255,0.6);
                    color:#fff; border-radius:4px; padding:1px 7px;
                    cursor:pointer; font-size:14px; line-height:1.4;
                ">－</button>
            </div>

            <!-- 可折叠主体 -->
            <div id="zt-body" style="padding:12px;">
                <!-- 后端地址 -->
                <div style="margin-bottom:8px;">
                    <label style="font-size:11px;color:#888;">后端地址</label>
                    <input id="zt-host-input" value="${savedHost}" style="
                        width:100%; box-sizing:border-box; padding:5px 7px;
                        border:1px solid #d9d9d9; border-radius:4px;
                        font-size:12px; margin-top:3px;
                    " />
                </div>

                <!-- 手动查题 -->
                <div style="margin-bottom:8px;">
                    <label style="font-size:11px;color:#888;">手动查题（粘贴题目）</label>
                    <textarea id="zt-search-input" rows="3" placeholder="粘贴题干，点击查询..." style="
                        width:100%; box-sizing:border-box; padding:5px 7px;
                        border:1px solid #d9d9d9; border-radius:4px;
                        font-size:12px; margin-top:3px; resize:vertical;
                        font-family:Arial,sans-serif;
                    "></textarea>
                    <button id="zt-search-btn" style="
                        width:100%; margin-top:5px; padding:6px;
                        background:#1890ff; color:#fff; border:none;
                        border-radius:4px; cursor:pointer; font-size:12px;
                    ">查询答案</button>
                    <div id="zt-search-result" style="
                        display:none; margin-top:6px; padding:6px 8px;
                        background:#fffbe6; border:1px solid #ffe58f;
                        border-radius:4px; font-size:12px; color:#333;
                        word-break:break-all; line-height:1.6;
                    "></div>
                </div>

                <div style="border-top:1px solid #f0f0f0; margin-bottom:8px;"></div>

                <!-- 自动答题状态 -->
                <div id="zt-status" style="
                    margin-bottom:6px; padding:6px 8px;
                    background:#f0f7ff; border-radius:5px;
                    font-size:12px; color:#333;
                ">状态：等待开始</div>
                <div id="zt-progress" style="margin-bottom:10px; font-size:12px; color:#555;">
                    进度：0 / 0
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="zt-start" style="
                        flex:1; padding:7px; background:#52c41a;
                        color:#fff; border:none; border-radius:5px; cursor:pointer;
                    ">开始答题</button>
                    <button id="zt-stop" disabled style="
                        flex:1; padding:7px; background:#ff4d4f;
                        color:#fff; border:none; border-radius:5px; cursor:pointer;
                    ">停止</button>
                </div>
            </div>
        `;
    document.body.appendChild(panel);

    document.getElementById("zt-start").onclick = startAutoAnswer;
    document.getElementById("zt-stop").onclick = stopAutoAnswer;

    document.getElementById("zt-host-input").onchange = (e) => {
      GM_setValue("serverHost", e.target.value.trim());
    };

    // 最小化 / 还原
    document.getElementById("zt-toggle").onclick = () => {
      panelMinimized = !panelMinimized;
      const body = document.getElementById("zt-body");
      const toggle = document.getElementById("zt-toggle");
      body.style.display = panelMinimized ? "none" : "block";
      toggle.textContent = panelMinimized ? "＋" : "－";
    };

    // 手动查题
    document.getElementById("zt-search-btn").onclick = manualSearch;
    document
      .getElementById("zt-search-input")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) manualSearch();
      });
  }

  async function manualSearch() {
    const input = document.getElementById("zt-search-input");
    const result = document.getElementById("zt-search-result");
    const btn = document.getElementById("zt-search-btn");
    const term = cleanStem(input.value);

    if (!term) return;

    btn.disabled = true;
    btn.textContent = "查询中...";
    result.style.display = "none";

    const texts = await queryServer(term);

    btn.disabled = false;
    btn.textContent = "查询答案";
    result.style.display = "block";

    if (texts && texts.length > 0) {
      result.style.background = "#f6ffed";
      result.style.borderColor = "#b7eb8f";
      result.innerHTML = `<b style="color:#52c41a;">答案：</b>${texts
        .map(
          (t) => `<span style="
                display:inline-block; background:#52c41a; color:#fff;
                padding:1px 7px; border-radius:3px; margin:2px 3px 2px 0;
            ">${t}</span>`
        )
        .join("")}`;
    } else {
      result.style.background = "#fff2f0";
      result.style.borderColor = "#ffa39e";
      result.innerHTML = '<span style="color:#ff4d4f;">题库中未找到该题</span>';
    }
  }

  function setStatus(text) {
    const el = document.getElementById("zt-status");
    if (el) el.textContent = "状态：" + text;
  }

  function setProgress(cur, total) {
    const el = document.getElementById("zt-progress");
    if (el) el.textContent = `进度：${cur} / ${total}`;
  }

  // ----------------------------------------------------------------
  // 解析页面题目
  // ----------------------------------------------------------------
  function getAllQuestions() {
    let containers = document.querySelectorAll(".sub-content[data-v-a98933d6]");
    if (!containers.length)
      containers = document.querySelectorAll(".sub-content");

    const questions = [];
    containers.forEach((el, idx) => {
      try {
        const qp = el.querySelector('p[id^="question_"]');
        if (!qp) return;

        const rawText = qp.textContent.trim();
        const cleanText = cleanStem(rawText);

        const radioLabels = el.querySelectorAll("label.el-radio");
        const checkboxLabels = el.querySelectorAll("label.el-checkbox");

        let questionType, labels;
        if (checkboxLabels.length > 0) {
          questionType = "checkbox";
          labels = Array.from(checkboxLabels);
        } else if (radioLabels.length > 0) {
          questionType = "radio";
          labels = Array.from(radioLabels);
        } else {
          return;
        }

        // 选项文字（去除 "A、" 这类前缀）
        const options = labels.map((lbl) => {
          const span = lbl.querySelector(
            ".el-radio__label, .el-checkbox__label"
          );
          const full = span ? span.textContent.trim() : "";
          // 去除 "A、" / "A." / "A " 前缀，保留纯文字
          return full.replace(/^[A-Za-z][、.．\s]\s*/, "");
        });

        questions.push({
          index: idx + 1,
          element: el,
          cleanText,
          questionType,
          labels,
          options,
        });
        console.log(
          `[AA] Q${idx + 1} (${questionType}): ${cleanText.slice(0, 40)}...`
        );
      } catch (e) {
        console.error("[AA] 解析出错:", e);
      }
    });
    return questions;
  }

  // ----------------------------------------------------------------
  // 查询题库
  // ----------------------------------------------------------------
  function queryServer(questionText) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `${getServerUrl()}?term=${encodeURIComponent(questionText)}`,
        timeout: 6000,
        onload(res) {
          try {
            if (res.status === 200) {
              const data = JSON.parse(res.responseText);
              if (
                Array.isArray(data.answer_texts) &&
                data.answer_texts.length > 0
              ) {
                console.log(
                  `[AA] 找到答案:`,
                  data.answer_texts,
                  "匹配:",
                  data.matched_stem?.slice(0, 30)
                );
                resolve(data.answer_texts);
                return;
              }
            }
          } catch (_) {}
          resolve(null);
        },
        onerror() {
          resolve(null);
        },
        ontimeout() {
          resolve(null);
        },
      });
    });
  }

  // ----------------------------------------------------------------
  // 按文字匹配并点击选项
  // ----------------------------------------------------------------

  /** 在选项列表中找到文字最接近的索引 */
  function findOptionIndex(options, targetText) {
    const t = targetText.trim();

    // 精确匹配
    let idx = options.findIndex((o) => o === t);
    if (idx >= 0) return idx;

    // 包含匹配
    idx = options.findIndex((o) => o.includes(t) || t.includes(o));
    if (idx >= 0) return idx;

    return -1;
  }

  function clickLabel(label) {
    label.click();
    const input = label.querySelector("input");
    if (input) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function selectAnswer(question, answerTexts) {
    if (!answerTexts || answerTexts.length === 0) return false;

    if (question.questionType === "radio") {
      // 单选：取第一个答案文字
      const idx = findOptionIndex(question.options, answerTexts[0]);
      const target = idx >= 0 ? idx : 0;
      const label = question.labels[target];
      if (!label) return false;
      clickLabel(label);
      console.log(
        `[AA] Q${question.index} 单选 → "${question.options[target]}"`
      );
      return true;
    } else {
      // 多选：先取消所有已选，再逐一点击
      question.labels.forEach((lbl) => {
        const input = lbl.querySelector("input");
        if (input?.checked) lbl.click();
      });

      let success = 0;
      answerTexts.forEach((text) => {
        const idx = findOptionIndex(question.options, text);
        if (idx < 0 || idx >= question.labels.length) return;
        clickLabel(question.labels[idx]);
        success++;
      });
      console.log(
        `[AA] Q${question.index} 多选 → ${answerTexts.join(
          "、"
        )}, 选中 ${success} 项`
      );
      return success > 0;
    }
  }

  // ----------------------------------------------------------------
  // 主流程
  // ----------------------------------------------------------------
  async function startAutoAnswer() {
    if (isRunning) return;
    isRunning = true;
    answeredCount = 0;

    document.getElementById("zt-start").disabled = true;
    document.getElementById("zt-stop").disabled = false;

    setStatus("扫描题目...");
    const questions = getAllQuestions();
    totalQuestions = questions.length;

    if (!totalQuestions) {
      setStatus("未找到题目，请确认页面已加载");
      stopAutoAnswer();
      return;
    }

    setStatus(`找到 ${totalQuestions} 题，开始作答...`);

    for (let i = 0; i < questions.length; i++) {
      if (!isRunning) break;

      const q = questions[i];
      setProgress(i + 1, totalQuestions);
      setStatus(`第 ${i + 1} 题：查询中...`);

      q.element.scrollIntoView({ behavior: "smooth", block: "center" });
      await delay();
      if (!isRunning) break;

      const answerTexts = await queryServer(q.cleanText);
      if (!isRunning) break;

      if (answerTexts) {
        selectAnswer(q, answerTexts);
        answeredCount++;
        setStatus(`第 ${i + 1} 题：已作答 (${answerTexts.join("、")})`);
      } else {
        setStatus(`第 ${i + 1} 题：题库未收录，跳过`);
      }

      if (i < questions.length - 1) await delay();
    }

    if (isRunning) {
      setStatus(`完成！共 ${totalQuestions} 题，已答 ${answeredCount} 题`);
      setProgress(totalQuestions, totalQuestions);
    }
    stopAutoAnswer();
  }

  function stopAutoAnswer() {
    isRunning = false;
    const s = document.getElementById("zt-start");
    const t = document.getElementById("zt-stop");
    if (s) s.disabled = false;
    if (t) t.disabled = true;
  }

  // ----------------------------------------------------------------
  // 初始化
  // ----------------------------------------------------------------
  function isTestPage() {
    return location.hash.includes("/paper/testing/");
  }

  function init() {
    if (!isTestPage()) return;
    console.log("[AA] 检测到答题页面，初始化...");
    setTimeout(createPanel, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // SPA 路由切换检测
  let lastHash = location.hash;
  setInterval(() => {
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      if (isTestPage()) setTimeout(createPanel, 2000);
    }
  }, 1000);
})();
