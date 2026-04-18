import requests
import json
import os
import glob
import re

# 配置区域
COLLECTION_ID = input("请输入 collectionId: ")

# 从配置文件读取 AUTH_TOKEN
AUTH_TOKEN = ""
config_path = os.path.join(os.path.dirname(__file__), "config.json")
if os.path.exists(config_path):
    with open(config_path, "r", encoding="utf-8") as f:
        try:
            config = json.load(f)
            AUTH_TOKEN = config.get("AUTH_TOKEN", "")
        except json.JSONDecodeError:
            print("配置文件解析失败，请检查 config.json 格式。")
else:
    print("找不到 config.json 配置文件。")

if not AUTH_TOKEN or AUTH_TOKEN == "在此处填入你的 x-auth-token":
    AUTH_TOKEN = input("未读取到有效的 token，请输入 x-auth-token: ")

HEADERS = {
    "Cookie": f"x-auth-token={AUTH_TOKEN}",
    "x-auth-token": AUTH_TOKEN,
    "Content-Type": "application/json"
}

BASE_URL = "http://www.ztplus.cn/qam/student/userCollection"

# 加载本地题库
def load_question_bank():
    question_bank = {}
    answer_dir = os.path.join(os.path.dirname(__file__), "answer")
    for file_path in glob.glob(os.path.join(answer_dir, "*.json")):
        with open(file_path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                for item in data:
                    # 简单去除空白字符以便匹配
                    q_text = re.sub(r'\s+', '', item.get("question", ""))
                    question_bank[q_text] = item.get("answer", "")
            except Exception as e:
                print(f"Error loading {file_path}: {e}")
    print(f"成功加载题库，共 {len(question_bank)} 道题目")
    return question_bank

def get_paper_detail(collection_id):
    url = f"{BASE_URL}/startCollection/{collection_id}"
    response = requests.post(url, headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"获取题目列表失败: {response.status_code}")
        return None

def submit_answer(collection_id, user_collection_id, index, options):
    url = f"{BASE_URL}/submitAnswer"
    payload = {
        "collectionId": collection_id,
        "userCollectionId": user_collection_id,
        "index": index,
        "optionAnswer": options
    }
    response = requests.post(url, headers=HEADERS, json=payload)
    if response.status_code == 200:
        res = response.json()
        if res.get("code") == 0:
            print(f"第 {index + 1} 题提交成功")
        else:
            print(f"第 {index + 1} 题提交异常: {res}")
    else:
        print(f"第 {index + 1} 题提交失败: {response.status_code}")

def map_answer_to_options(answer_str, options, q_type):
    # 将 ABCD 转换成对应的选项，或者处理判断题
    answer_letters = list(answer_str.upper())
    
    # 选项排序，确保 ABCD 对应 0123
    options = sorted(options, key=lambda x: x.get("optionId"))
    
    # 构建新的 optionAnswer 列表
    new_options = []
    
    if q_type == "JUDGE":
        # 判断题 A 表示正确，B 表示错误
        is_correct = "A" in answer_letters
        for opt in options:
            opt_copy = opt.copy()
            text = opt_copy.get("text", "")
            if "正确" in text or "对" in text or "是" in text:
                opt_copy["selected"] = is_correct
            elif "错误" in text or "错" in text or "否" in text:
                opt_copy["selected"] = not is_correct
            else:
                opt_copy["selected"] = False
            new_options.append(opt_copy)
    else:
        # 单选/多选
        mapping = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5}
        selected_indexes = [mapping.get(letter) for letter in answer_letters if letter in mapping]
        
        for i, opt in enumerate(options):
            opt_copy = opt.copy()
            opt_copy["selected"] = (i in selected_indexes)
            new_options.append(opt_copy)
            
    return new_options

def main():
    question_bank = load_question_bank()
    
    print("正在获取题目列表...")
    data = get_paper_detail(COLLECTION_ID)
    if not data or data.get("code") != 0:
        print("获取失败，请检查 token 或 collectionId")
        return
    
    detail = data.get("data", {})
    user_collection_id = detail.get("userCollectionId")
    collection_id = detail.get("collectionId")
    paper_detail = detail.get("paperDetail", [])
    
    print(f"获取到 {len(paper_detail)} 道题目，准备开始作答...")
    
    for index, q in enumerate(paper_detail):
        content = q.get("content", "")
        clean_content = re.sub(r'\s+', '', content)
        options = q.get("options", [])
        q_type = q.get("type", "")
        
        # 匹配答案
        answer_str = question_bank.get(clean_content)
        
        if not answer_str:
            print(f"第 {index + 1} 题未找到答案: {content}")
            continue
            
        new_options = map_answer_to_options(answer_str, options, q_type)
        submit_answer(collection_id, user_collection_id, index, new_options)

if __name__ == "__main__":
    main()
