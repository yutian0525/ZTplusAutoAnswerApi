import requests
import json
import os
import glob
import re

# 配置区域
COURSE_ID = input("请输入课程 ID (例如 369859935833731072): ")

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

def get_collection_list(course_id):
    url = f"{BASE_URL}/{course_id}/PRACTICE"
    response = requests.get(url, headers=HEADERS)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"获取练习列表失败: {response.status_code}")
        return None

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
                    question_bank[q_text] = {
                        "answer": item.get("answer", ""),
                        "file": file_path
                    }
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

def submit_answer(collection_id, user_collection_id, index, options, q_info=None, q_type=None):
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
            data = res.get("data", {})
            if data.get("correct") is False and q_info:
                # 答错了，更新题库
                file_path = q_info.get("file")
                answer_options = data.get("answerOptions", [])
                update_question_bank_file(file_path, q_info.get("original_question"), answer_options, q_type)
                print(f"第 {index + 1} 题提交成功，但回答错误，已更新题库答案")
                return "WRONG"
            else:
                print(f"第 {index + 1} 题提交成功")
                return "CORRECT"
        else:
            print(f"第 {index + 1} 题提交异常: {res}")
            return "ERROR"
    else:
        print(f"第 {index + 1} 题提交失败: {response.status_code}")
        return "ERROR"

def update_question_bank_file(file_path, original_question, answer_options, q_type):
    if not file_path or not os.path.exists(file_path):
        return
    
    # 解析正确答案
    sorted_opts = sorted(answer_options, key=lambda x: x.get("optionId", 0))
    correct_letters = []
    
    if q_type == "JUDGE":
        for opt in sorted_opts:
            if opt.get("correct"):
                text = opt.get("text", "")
                if "正确" in text or "对" in text or "是" in text:
                    correct_letters.append("A")
                elif "错误" in text or "错" in text or "否" in text:
                    correct_letters.append("B")
                else:
                    # 默认按照第一个选项为A，第二个为B
                    correct_letters.append("A" if sorted_opts.index(opt) == 0 else "B")
    else:
        mapping = {0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F"}
        for i, opt in enumerate(sorted_opts):
            if opt.get("correct"):
                correct_letters.append(mapping.get(i, ""))
                
    new_answer = "".join(correct_letters)
    if not new_answer:
        return

    # 写入文件
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        clean_target = re.sub(r'\s+', '', original_question)
        for item in data:
            if re.sub(r'\s+', '', item.get("question", "")) == clean_target:
                item["answer"] = new_answer
                break
                
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
    except Exception as e:
        print(f"更新题库文件失败: {e}")

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

def run_paper(collection_id):
    question_bank = load_question_bank()
    
    print("正在获取题目列表...")
    data = get_paper_detail(collection_id)
    if not data or data.get("code") != 0:
        print("获取失败，请检查 token 或 collectionId")
        return False
    
    detail = data.get("data", {})
    user_collection_id = detail.get("userCollectionId")
    paper_collection_id = detail.get("collectionId")
    paper_detail = detail.get("paperDetail", [])
    
    print(f"获取到 {len(paper_detail)} 道题目，准备开始作答...")
    
    has_error = False
    for index, q in enumerate(paper_detail):
        content = q.get("content", "")
        clean_content = re.sub(r'\s+', '', content)
        options = q.get("options", [])
        q_type = q.get("type", "")
        
        # 匹配答案
        q_info = question_bank.get(clean_content)
        
        if not q_info:
            print(f"第 {index + 1} 题未找到答案: {content}")
            has_error = True
            continue
            
        answer_str = q_info.get("answer", "")
        q_info["original_question"] = content
        
        new_options = map_answer_to_options(answer_str, options, q_type)
        status = submit_answer(paper_collection_id, user_collection_id, index, new_options, q_info, q_type)
        if status == "WRONG":
            has_error = True
            
    return has_error

def main():
    collections_data = get_collection_list(COURSE_ID)
    if not collections_data or collections_data.get("code") != 0:
        print("获取练习列表失败，请检查 courseId 或 token。")
        return
        
    c_list = collections_data.get("data", [])
    if not c_list:
        print("练习列表为空。")
        return
        
    print("\n=== 练习列表 ===")
    for idx, c in enumerate(c_list):
        name = c.get("name", "未知")
        total = c.get("totalQuestion", 0)
        correct_num = c.get("correctNum", 0)
        error_num = c.get("errorNum", 0)
        status_text = "已完成" if correct_num >= total and error_num == 0 else "未完成(含错题)" if error_num > 0 else "未完成"
        print(f"[{idx}] {name} (总题: {total}, 正确: {correct_num}, 错误: {error_num}) - {status_text}")
        
    choice = input("\n请输入要作答的练习序号: ")
    try:
        choice_idx = int(choice)
        collection_id = c_list[choice_idx].get("collectionId")
    except (ValueError, IndexError):
        print("输入无效。")
        return
        
    while True:
        has_error = run_paper(collection_id)
        if has_error:
            retry = input("\n存在答错并更新题库的情况（或者找不到答案的题），是否重新答题？(y/n): ")
            if retry.lower() != 'y':
                break
        else:
            print("\n全部答题完成且无错误！")
            break

if __name__ == "__main__":
    main()
