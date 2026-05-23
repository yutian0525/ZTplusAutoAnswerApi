import json
import os
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# 内存题库：{ question_text: correct_answer }
_question_bank: dict[str, str] = {}


def load_json_files():
    """加载题库1.json ~ 题库10.json 到内存"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    loaded, skipped = 0, 0

    for i in range(1, 11):
        path = os.path.join(base_dir, f'题库{i}.json')
        if not os.path.exists(path):
            print(f"[题库] 文件不存在，跳过: {path}")
            continue

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"[题库] 读取 {path} 失败: {e}")
            continue

        if not isinstance(data, list):
            print(f"[题库] {path} 格式错误（需为数组），跳过")
            continue

        for item in data:
            q = item.get('question', '').strip()
            a = item.get('answer', '').strip()
            if q and a:
                _question_bank[q] = a
                loaded += 1
            else:
                skipped += 1

        print(f"[题库] 已加载 {path}")

    print(f"[题库] 加载完成，共 {loaded} 题，跳过 {skipped} 条无效记录")


@app.route('/query', methods=['GET'])
def query_questions():
    term = request.args.get('term', '').strip()
    if not term:
        return jsonify({"error": "Search term is required"}), 400

    results = [
        {"question_text": q, "correct_answer": a}
        for q, a in _question_bank.items()
        if term in q
    ]
    return jsonify(results)


@app.route('/status', methods=['GET'])
def status():
    return jsonify({"status": "running", "total_questions_in_db": len(_question_bank)})


if __name__ == '__main__':
    load_json_files()
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
