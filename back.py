import uuid
from flask import Flask, request, jsonify
import mysql.connector
from mysql.connector import pooling
from flask_cors import CORS
import logging
from contextlib import contextmanager
from datetime import datetime
# 在文件顶部新增导入
import random
import string
import base64  # 添加这个导入
from PIL import Image, ImageDraw, ImageFont
import io



# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

app = Flask(__name__)
CORS(app, supports_credentials=True, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type", "Authorization"])

# 在 Flask app 配置下方新增验证码存储字典
captcha_store = {}

# 数据库连接池配置
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': '123456',
    'database': 'citybrain',
    'pool_name': 'citybrain_pool',
    'pool_size': 5,
    'autocommit': True,
    'port': 3306
}

try:
    db_pool = pooling.MySQLConnectionPool(**DB_CONFIG)
except mysql.connector.Error as err:
    logging.error(f"数据库连接池创建失败: {err}")
    exit(1)

def generate_token(user):
    return f"{user.get('employee_id', user.get('id', ''))}_{uuid.uuid4().hex}"

@contextmanager
def db_connection():
    conn = None
    try:
        conn = db_pool.get_connection()
        yield conn
    except mysql.connector.Error as err:
        logging.error(f"获取数据库连接失败: {err}")
        raise
    finally:
        if conn and conn.is_connected():
            conn.close()

@contextmanager
def db_cursor(connection=None, commit=False):
    conn = connection or db_pool.get_connection()
    cursor = None
    try:
        cursor = conn.cursor(dictionary=True)
        yield cursor
        if commit:
            conn.commit()
    except mysql.connector.Error as err:
        logging.error(f"数据库操作失败: {err}")
        conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if not connection and conn.is_connected():
            conn.close()

def execute_query(query, params=None, fetch_one=False):
    with db_connection() as conn:
        with db_cursor(conn) as cursor:
            cursor.execute(query, params or ())
            return cursor.fetchone() if fetch_one else cursor.fetchall()

def execute_update(query, params=None):
    with db_connection() as conn:
        with db_cursor(conn, commit=True) as cursor:
            cursor.execute(query, params or ())
            return cursor.rowcount

# ------------------ Token 验证中间件 ------------------
@app.before_request
def validate_token():
    # 放行CORS预检请求
    if request.method == 'OPTIONS':
        return
    # 白名单路径 - 添加了 /captcha
    if request.path in ['/staff_login', '/admin_login', '/captcha'] or request.path.startswith('/static/'):
        return
    token = request.headers.get('Authorization')
    if not token or not token.startswith('Bearer '):
        return jsonify({"error": "缺少认证信息"}), 401
    token = token[7:]
    with db_connection() as conn:
        with db_cursor(conn) as cursor:
            cursor.execute("SELECT employee_id, expires_at FROM auth_tokens WHERE token=%s", (token,))
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "无效Token"}), 401
            if row['expires_at'] < datetime.now():
                return jsonify({"error": "Token已过期"}), 401
            cursor.execute("SELECT role FROM employee_credentials WHERE employee_id=%s", (row['employee_id'],))
            role_row = cursor.fetchone()
            if not role_row or role_row['role'] != 'admin':
                return jsonify({"error": "无管理员权限"}), 403


# 新增验证码生成路由
# 修正验证码生成路由 - 添加字体回退逻辑
@app.route('/captcha')
def generate_captcha():
    try:
        # 生成随机的4位数字验证码
        captcha_text = ''.join(random.choices(string.digits, k=4))

        # 生成验证码图片
        image = Image.new('RGB', (120, 40), color=(255, 255, 255))
        draw = ImageDraw.Draw(image)

        # 尝试加载字体 - 添加回退机制
        try:
            font = ImageFont.truetype("arial.ttf", 28)
        except:
            # 如果找不到字体，使用默认字体
            font = ImageFont.load_default()
            logging.warning("使用默认字体生成验证码")

        # 绘制验证码文本
        draw.text((10, 5), captcha_text, font=font, fill=(0, 0, 0))

        # ===== 新增干扰线条 =====
        # 增加随机干扰线条数量
        for _ in range(15):  # 从0增加到15条干扰线
            # 随机起点和终点坐标
            start_x = random.randint(0, 120)
            start_y = random.randint(0, 40)
            end_x = random.randint(0, 120)
            end_y = random.randint(0, 40)

            # 随机线条颜色（浅色系，避免太明显）
            line_color = (
                random.randint(150, 220),
                random.randint(150, 220),
                random.randint(150, 220)
            )

            # 随机线条宽度
            line_width = random.randint(1, 2)

            # 绘制干扰线
            draw.line([(start_x, start_y), (end_x, end_y)], fill=line_color, width=line_width)

        # 添加干扰点（增加点数）
        for _ in range(200):  # 从100增加到200个干扰点
            x = random.randint(0, 120)
            y = random.randint(0, 40)
            point_color = (
                random.randint(100, 200),
                random.randint(100, 200),
                random.randint(100, 200)
            )
            draw.point((x, y), fill=point_color)

        # 将图片转换为字节流
        img_byte_arr = io.BytesIO()
        image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()

        # 生成唯一ID存储验证码
        captcha_id = str(uuid.uuid4())
        captcha_store[captcha_id] = captcha_text

        # 返回验证码图片和ID
        return jsonify({
            'captcha_id': captcha_id,
            'image_data': f"data:image/png;base64,{base64.b64encode(img_byte_arr).decode('utf-8')}"
        })
    except Exception as e:
        logging.error(f"验证码生成失败: {str(e)}")
        return jsonify({"error": "验证码生成失败"}), 500


# ------------------ 管理员/操作员登录 ------------------
# 修改管理员登录函数
@app.route('/admin_login', methods=['POST'])
def admin_login():
    data = request.get_json()
    emp_id = data.get('employee_id')
    pwd = data.get('password')
    captcha_id = data.get('captcha_id')
    user_captcha = data.get('captcha', '').strip()

    # 验证码验证
    if not captcha_id or captcha_id not in captcha_store:
        return jsonify({"error": "验证码无效或已过期"}), 401

    server_captcha = captcha_store.pop(captcha_id, '')
    if server_captcha.lower() != user_captcha.lower():
        return jsonify({"error": "验证码错误"}), 401

    # 原有用户验证逻辑
    user = execute_query(
        "SELECT employee_id, role, full_name FROM employee_credentials WHERE employee_id=%s AND password=%s AND role='admin'",
        (emp_id, pwd), fetch_one=True
    )
    if user:
        token = generate_token(user)
        with db_connection() as conn:
            with db_cursor(conn, commit=True) as cursor:
                cursor.execute(
                    "INSERT INTO auth_tokens (token, employee_id, expires_at) VALUES (%s, %s, NOW() + INTERVAL 1 HOUR)",
                    (token, user['employee_id'])
                )
        return jsonify({"status": "success", "user": user, "token": token})
    else:
        return jsonify({"error": "账号或密码错误，或无管理员权限"}), 401


# ------------------ 工作人员控制台登录 ------------------
@app.route('/staff_login', methods=['POST'])
def staff_login():
    data = request.get_json()
    emp_id = data.get('employee_id')
    pwd = data.get('password')

    # 只允许特定角色的员工登录
    user = execute_query(
        "SELECT employee_id, role, full_name FROM employee_credentials "
        "WHERE employee_id=%s AND password=%s AND role IN ('operator', 'admin')",
        (emp_id, pwd),
        fetch_one=True
    )

    if user:
        token = generate_token(user)
        with db_connection() as conn:
            with db_cursor(conn, commit=True) as cursor:
                cursor.execute(
                    "INSERT INTO auth_tokens (token, employee_id, expires_at) "
                    "VALUES (%s, %s, NOW() + INTERVAL 8 HOUR)",
                    (token, user['employee_id'])
                )
        return jsonify({
            "status": "success",
            "user_info": {
                "employee_id": user['employee_id'],
                "full_name": user['full_name'],
                "role": user['role']
            },
            "token": token
        })
    else:
        return jsonify({"error": "账号不存在或无权访问"}), 403

# ------------------ 红绿灯管理 ------------------
@app.route('/admin/traffic_lights', methods=['GET'])
def admin_get_traffic_lights():
    intersection_id = request.args.get('intersection_id')
    if intersection_id:
        lights = execute_query(
            "SELECT * FROM traffic_lights WHERE intersection_id=%s ORDER BY light_id", (intersection_id,))
    else:
        lights = execute_query("SELECT * FROM traffic_lights ORDER BY intersection_id, light_id")
    return jsonify(lights)

@app.route('/admin/traffic_lights', methods=['PUT'])
def admin_update_traffic_light():
    data = request.get_json()
    intersection_id = data['intersection_id']
    light_id = data['light_id']
    red_duration = data['red_duration']
    green_duration = data['green_duration']
    current_status = data['current_status']
    execute_update(
        "UPDATE traffic_lights SET red_duration=%s, green_duration=%s, current_status=%s WHERE intersection_id=%s AND light_id=%s",
        (red_duration, green_duration, current_status, intersection_id, light_id)
    )
    return jsonify({"status": "success"})

# ------------------ 车流量管理 ------------------
@app.route('/admin/traffic_flow', methods=['GET'])
def admin_get_traffic_flow():
    intersection_id = request.args.get('intersection_id')
    date = request.args.get('date')
    if not intersection_id:
        return jsonify({"error": "缺少 intersection_id"}), 400
    table = f"traffic_flow{intersection_id}"
    if date:
        flows = execute_query(f"SELECT * FROM {table} WHERE record_date=%s", (date,))
    else:
        flows = execute_query(f"SELECT * FROM {table} ORDER BY record_date DESC LIMIT 24")
    return jsonify(flows)

# ------------------ 事故记录管理 ------------------
@app.route('/admin/accidents', methods=['GET'])
def admin_get_accidents():
    intersection_id = request.args.get('intersection_id')
    if not intersection_id:
        return jsonify({"error": "缺少 intersection_id"}), 400
    table = f"accident_records{intersection_id}"
    records = execute_query(f"SELECT * FROM {table} ORDER BY date DESC")
    return jsonify(records)


# ------------------ 用户管理 ------------------
@app.route('/admin/users', methods=['GET'])
def admin_get_users():
    users = execute_query("SELECT id, username, email, phone, password, role, created_at FROM user_accounts")
    # 不返回真实密码，只返回密码存在标识
    for user in users:
        user['has_password'] = bool(user['password'])
        del user['password']
    return jsonify(users)


# 新增密码重置功能
@app.route('/admin/users/reset_password', methods=['POST'])
def admin_reset_password():
    data = request.get_json()
    user_id = data['id']
    new_password = data['new_password']

    if not new_password:
        return jsonify({"error": "新密码不能为空"}), 400

    # 在实际应用中应对密码进行加盐哈希处理
    # 这里使用MD5简化演示，实际应用应使用bcrypt或类似安全哈希
    import hashlib
    hashed_password = hashlib.md5(new_password.encode()).hexdigest()

    execute_update("UPDATE user_accounts SET password=%s WHERE id=%s", (hashed_password, user_id))
    return jsonify({"status": "success"})

@app.route('/admin/users/role', methods=['PUT'])
def admin_update_user_role():
    data = request.get_json()
    user_id = data['id']
    role = data['role']
    execute_update("UPDATE user_accounts SET role=%s WHERE id=%s", (role, user_id))
    return jsonify({"status": "success"})
@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    # 不允许删除admin用户
    user = execute_query("SELECT role FROM user_accounts WHERE id=%s", (user_id,), fetch_one=True)
    if not user:
        return jsonify({"error": "用户不存在"}), 404
    if user['role'] == 'admin':
        return jsonify({"error": "不能删除管理员用户"}), 403
    execute_update("DELETE FROM user_accounts WHERE id=%s", (user_id,))
    return jsonify({"status": "success"})
# ------------------ 工作人员管理（仅admin可用） ------------------

# 查询所有工作人员（operator）
@app.route('/admin/operators', methods=['GET'])
def admin_get_operators():
    operators = execute_query(
        "SELECT employee_id, full_name, role, status FROM employee_credentials WHERE role='operator'"
    )
    return jsonify(operators)

# 新增工作人员
@app.route('/admin/operators', methods=['POST'])
def admin_add_operator():
    data = request.get_json()
    employee_id = data.get('employee_id')
    password = data.get('password')
    full_name = data.get('full_name')
    status = data.get('status', 'active')
    # 检查是否已存在
    exists = execute_query(
        "SELECT employee_id FROM employee_credentials WHERE employee_id=%s", (employee_id,), fetch_one=True
    )
    if exists:
        return jsonify({"error": "工号已存在"}), 409
    execute_update(
        "INSERT INTO employee_credentials (employee_id, password, role, full_name, status) VALUES (%s, %s, 'operator', %s, %s)",
        (employee_id, password, full_name, status)
    )
    return jsonify({"status": "success"})

# 删除工作人员
@app.route('/admin/operators/<employee_id>', methods=['DELETE'])
def admin_delete_operator(employee_id):
    # 不允许删除admin
    op = execute_query(
        "SELECT role FROM employee_credentials WHERE employee_id=%s", (employee_id,), fetch_one=True
    )
    if not op or op['role'] != 'operator':
        return jsonify({"error": "只能删除operator"}), 400
    execute_update(
        "DELETE FROM employee_credentials WHERE employee_id=%s", (employee_id,)
    )
    return jsonify({"status": "success"})

# 修改工作人员信息（仅支持full_name、password、status）
@app.route('/admin/operators/<employee_id>', methods=['PUT'])
def admin_update_operator(employee_id):
    data = request.get_json()
    fields = []
    params = []
    if 'full_name' in data:
        fields.append("full_name=%s")
        params.append(data['full_name'])
    if 'password' in data:
        fields.append("password=%s")
        params.append(data['password'])
    if 'status' in data:
        fields.append("status=%s")
        params.append(data['status'])
    if not fields:
        return jsonify({"error": "无可修改字段"}), 400
    params.append(employee_id)
    sql = f"UPDATE employee_credentials SET {', '.join(fields)} WHERE employee_id=%s AND role='operator'"
    execute_update(sql, tuple(params))
    return jsonify({"status": "success"})



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)