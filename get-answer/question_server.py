import json
import os
import re
import difflib
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

_questions: list[dict] = []

# ----------------------------------------------------------------
# 启动加载
# ----------------------------------------------------------------
def load_questions():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ncre3_theory_all.json')
    with open(path, 'r', encoding='utf-8') as f:
        _questions.extend(json.load(f))
    print(f'[题库] 加载完成，共 {len(_questions)} 题')

# ----------------------------------------------------------------
# 文本清洗
# ----------------------------------------------------------------
_CLEAN_RE = re.compile(
    r'^\d+[.、\s]+|'   # 开头题号：1. / 1、 / 1
    r'（\s*）|'         # 占位括号（  ）
    r'\(\s*\)|'         # 占位括号(  )
    r'\s+'              # 多余空白
)

def clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r'^\d+[.、]\s*', '', text)   # 去题号
    text = re.sub(r'（\s+）', '（）', text)     # 规范化占位符
    text = re.sub(r'\(\s+\)', '()', text)
    text = re.sub(r'\s+', ' ', text)
    return text

# ----------------------------------------------------------------
# 模糊查找
# ----------------------------------------------------------------
def find_best(term: str) -> dict | None:
    q_clean = clean(term)
    if not q_clean:
        return None

    best: dict | None = None
    best_score = 0.0

    for q in _questions:
        stem = clean(q['questionStem'])

        # 精确匹配直接返回
        if q_clean == stem:
            return q

        # 包含匹配（短串被长串包含）
        short, long = (q_clean, stem) if len(q_clean) <= len(stem) else (stem, q_clean)
        if short in long:
            score = len(short) / len(long)
        else:
            score = difflib.SequenceMatcher(None, q_clean, stem).ratio()

        if score > best_score:
            best_score = score
            best = q

    # 相似度阈值 0.70
    return best if best_score >= 0.70 else None

def resolve_texts(q: dict) -> list[str]:
    """将答案字母映射为选项文字列表（支持多选如 'AB'）"""
    options = q.get('option', [])
    answer  = q.get('answer', '')
    result  = []
    for ch in answer.upper():
        idx = ord(ch) - ord('A')
        if 0 <= idx < len(options):
            result.append(options[idx])
    return result

# ----------------------------------------------------------------
# 接口
# ----------------------------------------------------------------
@app.route('/query', methods=['GET'])
def query():
    term = request.args.get('term', '').strip()
    if not term:
        return jsonify({'error': 'term is required'}), 400

    q = find_best(term)
    if q:
        texts = resolve_texts(q)
        return jsonify({
            'answer_texts': texts,          # 选项文字列表，如 ["正确"] 或 ["职业行为规范"]
            'answer_letter': q.get('answer'),
            'matched_stem': q.get('questionStem'),
        })
    return jsonify({'answer_texts': []})

@app.route('/status', methods=['GET'])
def status():
    return jsonify({'status': 'running', 'total': len(_questions)})

if __name__ == '__main__':
    load_questions()
    print('Starting Flask server on http://localhost:5011')
    app.run(host='0.0.0.0', port=5011, debug=False)
