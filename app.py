import uuid
from flask import Flask, request, jsonify,g
import mysql.connector
from mysql.connector import pooling
from datetime import datetime, timedelta
import time
import threading
import traceback
import logging
from contextlib import contextmanager
from apscheduler.schedulers.background import BackgroundScheduler
from flask_cors import CORS
from flask import send_file
import openpyxl
from io import BytesIO
import matplotlib.pyplot as plt
#配置日志
#在文件开头配置日志格式
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)

app = Flask(__name__)
CORS(app)


# 在 Flask 应用初始化后添加
@app.after_request
def add_cors_headers(response):
    """添加 CORS 头到所有响应"""
    # 允许前端运行的来源
    allowed_origins = ['http://127.0.0.1:5500', 'http://localhost:5500']
    origin = request.headers.get('Origin')

    if origin in allowed_origins:
        response.headers['Access-Control-Allow-Origin'] = origin

    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
    return response


# 添加 OPTIONS 请求处理器
@app.before_request
def handle_options_request():
    """处理 OPTIONS 预检请求"""
    if request.method == 'OPTIONS':
        response = jsonify({"status": "preflight"})

        # 允许前端运行的来源
        allowed_origins = ['http://127.0.0.1:5500', 'http://localhost:5500']
        origin = request.headers.get('Origin')

        if origin in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin

        response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        return response


#数据库连接池配置
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
#创建连接池
try:
    db_pool = pooling.MySQLConnectionPool(**DB_CONFIG)
except mysql.connector.Error as err:
    logging.error(f"数据库连接池创建失败: {err}")
    exit(1)

car_count_lock = threading.Lock()

def generate_token(user):
    # 兼容员工和普通用户
    if 'employee_id' in user:
        uid = user['employee_id']
    elif 'id' in user:
        uid = user['id']
    else:
        uid = user.get('id', user.get('employee_id', ''))
    return f"{uid}-{uuid.uuid4().hex}-{int(time.time())}"

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

def clean_old_traffic_flow_data():
    """清理所有路口超过5年的车流量数据"""
    try:
        five_years_ago = (datetime.now() - timedelta(days=5*365)).strftime("%Y-%m-%d")
        with db_connection() as conn:
            with conn.cursor() as cursor:
                for intersection_id in range(1, 16):
                    table_name = f"traffic_flow{intersection_id}"
                    cursor.execute(
                        f"DELETE FROM {table_name} WHERE record_date < %s",
                        (five_years_ago,)
                    )
                conn.commit()
        logging.info("五年前的车流量数据已清理")
    except Exception as e:
        logging.error(f"清理车流量数据失败: {str(e)}")

#修改流量等级计算规则
def calculate_traffic_level(hourly_flow):
    """实时流量等级计算（按小时）"""
    if hourly_flow < 500:
        return 1  # 第一档
    elif 500 <= hourly_flow < 1500:
        return 2  # 第二档
    else:
        return 3  # 第三档

def get_traffic_light_settings(intersection_id):
    """获取红绿灯配置模板"""
    return [
        {
            "light_id": 1,
            "levels": {
                1: {"red": 30, "green": 30},
                2: {"red": 30, "green": 60},
                3: {"red": 40, "green": 90}
            }
        },
        {
            "light_id": 2,
            "levels": {
                1: {"red": 30, "green": 30},
                2: {"red": 30, "green": 60},
                3: {"red": 40, "green": 90}
            }
        }
    ]


#修改智能定档核心函数
def update_traffic_light_settings():
    """动态更新红绿灯配置"""
    try:
        current_hour = datetime.now().hour
        yesterday = datetime.now() - timedelta(days=1)
        yesterday_str = yesterday.strftime("%Y-%m-%d")

        with db_connection() as conn:
            with conn.cursor() as cursor:
                for intersection_id in range(1, 16):
                    # 获取历史流量数据
                    cursor.execute(
                        f"SELECT flow_count FROM traffic_flow{intersection_id} "
                        "WHERE record_date = %s AND record_hour = %s",
                        (yesterday_str, current_hour)
                    )
                    result = cursor.fetchone()
                    flow = result['flow_count'] if result else 0

                    # 计算新配置
                    if flow >= 1500:
                        red, green = 40, 90
                    elif flow >= 500:
                        red, green = 30, 60
                    else:
                        red, green = 30, 30

                    # 更新红灯和绿灯持续时间
                    cursor.execute("""
                        UPDATE traffic_lights
                        SET red_duration = %s,
                            green_duration = %s
                        WHERE intersection_id = %s
                    """, (red, green, intersection_id))

                conn.commit()

    except Exception as e:
        logging.error(f"配置更新失败: {str(e)}")


def update_traffic_status():
    """状态切换时使用最新配置，并在绿灯延长后恢复原时长"""
    try:
        with db_connection() as conn:
            with conn.cursor(dictionary=True) as cursor:
                # 查找所有需要切换的灯
                cursor.execute("""
                    SELECT * FROM traffic_lights
                    WHERE next_switch_time <= NOW()
                """)
                lights = cursor.fetchall()

                for light in lights:
                    intersection_id = light['intersection_id']
                    light_id = light['light_id']
                    current_status = light['current_status']
                    red_duration = light['red_duration']
                    green_duration = light['green_duration']
                    original_green_duration = light['original_green_duration']

                    # 切换状态
                    if current_status == 'red':
                        new_status = 'green'
                        duration = green_duration
                    else:
                        new_status = 'red'
                        duration = red_duration

                    # 如果是从绿变红，且有 original_green_duration，需要恢复
                    if current_status == 'green' and original_green_duration is not None:
                        # 恢复 green_duration
                        cursor.execute("""
                            UPDATE traffic_lights
                            SET green_duration = %s,
                                original_green_duration = NULL,
                                current_status = %s,
                                last_switch_time = NOW(),
                                next_switch_time = NOW() + INTERVAL %s SECOND
                            WHERE intersection_id = %s AND light_id = %s
                        """, (
                            original_green_duration,  # 恢复
                            new_status,
                            duration,
                            intersection_id,
                            light_id
                        ))
                    else:
                        # 正常切换
                        cursor.execute("""
                            UPDATE traffic_lights
                            SET current_status = %s,
                                last_switch_time = NOW(),
                                next_switch_time = NOW() + INTERVAL %s SECOND
                            WHERE intersection_id = %s AND light_id = %s
                        """, (
                            new_status,
                            duration,
                            intersection_id,
                            light_id
                        ))

                conn.commit()
                logging.info("状态同步完成，并恢复了临时绿灯时长（如有）")

    except Exception as e:
        logging.error(f"状态更新失败: {str(e)}")

def update_light_schedule():
    """根据历史数据更新红绿灯配置"""
    try:
        # 获取昨天同时间段流量
        yesterday = datetime.now() - timedelta(days=1)
        current_hour = datetime.now().hour

        with db_connection() as conn:
            with conn.cursor() as cursor:
                for intersection_id in range(1, 16):
                    cursor.execute(
                        f"SELECT flow_count FROM traffic_flow{intersection_id} "
                        "WHERE record_date = %s AND record_hour = %s",
                        (yesterday.strftime("%Y-%m-%d"), current_hour)
                    )
                    result = cursor.fetchone()
                    flow = result['flow_count'] if result else 0

                    # 计算新配置
                    if flow >= 1500:
                        red, green = 40, 90
                    elif flow >= 500:
                        red, green = 30, 60
                    else:
                        red, green = 30, 30

                    # 更新配置（下个周期生效）
                    cursor.execute("""
                        UPDATE traffic_lights
                        SET red_duration = %s,
                            green_duration = %s
                        WHERE intersection_id = %s
                    """, (red, green, intersection_id))

                conn.commit()

    except Exception as e:
        logging.error(f"配置更新失败: {str(e)}")


def schedule_jobs():
    scheduler = BackgroundScheduler()
    # 每秒更新状态（关键精度）
    scheduler.add_job(update_traffic_status, 'interval', seconds=1)
    # 每小时同步配置
    scheduler.add_job(update_light_schedule, 'cron', hour='*')
    scheduler.add_job(update_traffic_status, 'interval', seconds=1)
    scheduler.add_job(update_light_schedule, 'cron', hour='*')
    # 新增：每天凌晨1点清理一次
    scheduler.add_job(clean_old_traffic_flow_data, 'cron', hour=1, minute=0)
    scheduler.start()




#通用数据库操作函数
def execute_query(query, params=None, fetch_one=False):
    """执行查询语句"""
    with db_connection() as conn:
        with db_cursor(conn) as cursor:
            cursor.execute(query, params or ())
            return cursor.fetchone() if fetch_one else cursor.fetchall()


def execute_update(query, params=None):
    """执行更新语句"""
    with db_connection() as conn:
        with db_cursor(conn, commit=True) as cursor:
            cursor.execute(query, params or ())
            return cursor.rowcount


#在通用数据库操作函数后添加以下内容

#在通用函数区域添加以下函数
#修改后的adjust_traffic_lights函数（确保精确计算时间）
def adjust_traffic_lights(intersection_id, light_id):
    """修正绿灯延长逻辑"""
    try:
        with db_connection() as conn:
            if not conn.is_connected():
                logging.error("数据库连接不可用")
                return False

            conn.start_transaction()
            cursor = None
            try:
                cursor = conn.cursor(dictionary=True)

                # 获取当前配置（包含实时状态）
                cursor.execute("""
                    SELECT 
                        green_duration,
                        original_green_duration,
                        current_status,
                        TIMESTAMPDIFF(SECOND, last_switch_time, NOW()) AS elapsed
                    FROM traffic_lights
                    WHERE intersection_id = %s
                      AND light_id = %s
                    FOR UPDATE
                """, (intersection_id, light_id))
                light = cursor.fetchone()

                if not light:
                    logging.error(f"信号灯不存在: {intersection_id}-{light_id}")
                    return False

                # 只有在 original_green_duration 为 NULL 时才记录原始值
                if light['original_green_duration'] is None:
                    base_duration = light['green_duration']
                    cursor.execute("""
                        UPDATE traffic_lights
                        SET original_green_duration = %s
                        WHERE intersection_id = %s AND light_id = %s
                    """, (base_duration, intersection_id, light_id))
                else:
                    base_duration = light['original_green_duration']

                new_duration = base_duration + 20

                # 动态计算剩余时间（如果当前是绿灯）
                new_next_switch = "next_switch_time"
                if light['current_status'] == 'green':
                    remaining = new_duration - light['elapsed']
                    if remaining > 0:
                        new_next_switch = f"NOW() + INTERVAL {remaining} SECOND"

                # 更新配置并立即生效
                cursor.execute(f"""
                    UPDATE traffic_lights
                    SET green_duration = %s,
                        next_switch_time = {new_next_switch}
                    WHERE intersection_id = %s
                      AND light_id = %s
                """, (new_duration, intersection_id, light_id))

                # 记录日志
                cursor.execute("""
                    INSERT INTO light_adjust_logs
                    (intersection_id, light_id, action_type, old_value, new_value)
                    VALUES (%s, %s, 'extend_green', %s, %s)
                """, (intersection_id, light_id, base_duration, new_duration))

                conn.commit()
                return True

            except mysql.connector.Error as err:
                logging.error(f"数据库错误: {err.msg}")
                if conn.in_transaction:
                    conn.rollback()
                return False
            finally:
                if cursor: cursor.close()

    except Exception as e:
        logging.error(f"系统异常: {str(e)}\n{traceback.format_exc()}")
        return False



#业务逻辑函数
#修改原有的红绿灯状态获取逻辑
def get_traffic_light_status(intersection_id):
    """实时剩余时间计算"""
    query = """
            SELECT light_id, \
                   current_status, \
                   red_duration, \
                   green_duration, \
                   TIMESTAMPDIFF(SECOND, last_switch_time, NOW()) AS current_duration, \
                   CASE current_status \
                       WHEN 'red' THEN red_duration \
                       ELSE green_duration \
                       END                                        AS total_duration
            FROM traffic_lights
            WHERE intersection_id = %s \
            """
    lights = execute_query(query, (intersection_id,))

    result = []
    for light in lights:
        remaining = max(light['total_duration'] - light['current_duration'], 0)
        result.append({
            'light_id': light['light_id'],
            'current_status': light['current_status'],
            'remaining_time': remaining,
            'next_switch': (
                    datetime.now() +
                    timedelta(seconds=remaining)
            ).strftime("%Y-%m-%d %H:%M:%S")
        })

    return result


def upload_traffic_data(intersections):
    """带数据校验的流量上传"""
    now = datetime.now()
    current_hour = now.replace(minute=0, second=0, microsecond=0)

    for node_id, count in intersections.items():
        # 校验数据有效性
        if not 1 <= node_id <= 15 or count < 0:
            continue

        execute_update(
            f"""
            INSERT INTO traffic_flow{node_id} 
            (record_hour, flow_count, record_date, time_period)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE 
            flow_count = flow_count + VALUES(flow_count)
            """,
            (current_hour.hour, count, current_hour.date(),
             f"{current_hour:%H:%M}-{(current_hour + timedelta(hours=1)):%H:%M}")
        )

#修改参数验证函数
def validate_intersection_id(intersection_id):
    """修正返回值结构"""
    if not intersection_id:
        return False, (jsonify({"error": "Missing intersection_id"}), 400)
    if not isinstance(intersection_id, str) or not intersection_id.isdigit():
        return False, (jsonify({"error": "Invalid intersection ID format"}), 400)
    table_num = int(intersection_id)
    if not 1 <= table_num <= 15:
        return False, (jsonify({"error": "Intersection ID out of range (1-15)"}), 400)
    return True, None



@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        required = ['username', 'password', 'email', 'phone']
        if not all(k in data and data[k] for k in required):
            logging.info("注册返回内容: %s", '{"error": "缺少必要字段"}')
            return jsonify({"error": "缺少必要字段"}), 400

        exists = execute_query(
            "SELECT id FROM user_accounts WHERE username=%s OR email=%s OR phone=%s",
            (data['username'], data['email'], data['phone']),
            fetch_one=True
        )
        if exists:
            logging.info("注册返回内容: %s", '{"error": "用户名、邮箱或手机号已存在"}')
            return jsonify({"error": "用户名、邮箱或手机号已存在"}), 409

        execute_update(
            "INSERT INTO user_accounts (username, password, email, phone, role) VALUES (%s, %s, %s, %s, %s)",
            (data['username'], data['password'], data['email'], data['phone'], 'user')
        )
        logging.info("注册返回内容: %s", '{"status": "success"}')
        return jsonify({"status": "success"}), 200

    except Exception as e:
        logging.error(f"注册失败: {str(e)}", exc_info=True)
        logging.info("注册返回内容: %s", '{"error": "注册失败"}')
        return jsonify({"error": "注册失败"}), 500


#修改token验证中间件
@app.before_request
def validate_token():
    # 放行登录、注册接口和静态资源
    excluded_paths = ['/login','/staff_login', '/register']
    if request.path in excluded_paths or request.path.startswith('/static/'):
        return

    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({"error": "认证信息缺失或格式错误"}), 401

    token = auth_header.split(' ')[1]
    now = datetime.now()

    with db_connection() as conn:
        with db_cursor(conn) as cursor:
            # 查询所有可能的token表
            cursor.execute("""
                (SELECT 'admin' AS user_type, employee_id AS user_id, expires_at 
                 FROM auth_tokens WHERE token = %s)
                UNION ALL
                (SELECT 'user' AS user_type, user_id, expires_at 
                 FROM user_tokens WHERE token = %s)
            """, (token, token))
            token_records = cursor.fetchall()

            if not token_records:
                return jsonify({"error": "无效的认证令牌"}), 401

            # 检查是否有有效的未过期token
            valid_token = None
            for record in token_records:
                if record['expires_at'] > datetime.now():
                    valid_token = record
                    break

            if not valid_token:
                return jsonify({"error": "认证令牌已过期"}), 401

            # 存储用户信息到全局对象
            g.user_type = valid_token['user_type']
            g.user_id = valid_token['user_id']


@app.route('/login', methods=['POST'])
def unified_login():
    try:
        data = request.get_json()
        if not data or 'username' not in data or 'password' not in data:
            logging.info("登录返回内容: %s", '{"error": "缺失必要参数"}')
            return jsonify({"error": "缺失必要参数"}), 400

        username = data['username'].strip()
        password = data['password'].strip()

        # 1. 先查员工表
        employee = execute_query(
            "SELECT employee_id AS id, full_name AS username, role, password "
            "FROM employee_credentials "
            "WHERE employee_id = %s",
            (username,),
            fetch_one=True
        )

        if employee and employee['password'] == password:
            user_type = employee['role']
            token = generate_token(employee)
            expires_at = datetime.now() + timedelta(hours=2)
            execute_update(
                "INSERT INTO auth_tokens (token, employee_id, expires_at) VALUES (%s, %s, %s)",
                (token, employee['id'], expires_at)
            )
            response = {
                "status": "success",
                "user_info": {
                    "id": employee['id'],
                    "username": employee['username'],
                    "role": employee['role'],
                    "user_type": user_type
                },
                "token": token
            }
            logging.info("登录返回内容: %s", response)
            return jsonify(response), 200

        # 2. 查普通用户表
        user = execute_query(
            "SELECT id, username, role, password "
            "FROM user_accounts "
            "WHERE username = %s",
            (username,),
            fetch_one=True
        )

        if user and user['password'] == password:
            user_type = 'user'
            token = generate_token(user)
            expires_at = datetime.now() + timedelta(hours=2)
            execute_update(
                "INSERT INTO user_tokens (token, user_id, expires_at) VALUES (%s, %s, %s)",
                (token, user['id'], expires_at)
            )
            response = {
                "status": "success",
                "user_info": {
                    "id": user['id'],
                    "username": user['username'],
                    "role": user['role'],
                    "user_type": user_type
                },
                "token": token
            }
            logging.info("登录返回内容: %s", response)
            return jsonify(response), 200

        logging.info("登录返回内容: %s", '{"error": "用户名或密码错误"}')
        return jsonify({"error": "用户名或密码错误"}), 401

    except Exception as e:
        logging.error(f"登录失败: {str(e)}", exc_info=True)
        logging.info("登录返回内容: %s", '{"error": "服务器内部错误"}')
        return jsonify({"error": "服务器内部错误"}), 500

@app.route('/staff_login', methods=['POST'])
def staff_login():
    try:
        data = request.get_json()
        if not data or 'employee_id' not in data or 'password' not in data:
            return jsonify({"error": "缺失必要参数"}), 400

        # 查询员工表
        staff = execute_query(
            "SELECT employee_id, full_name, role FROM employee_credentials WHERE employee_id = %s AND password = %s",
            (data['employee_id'], data['password']),
            fetch_one=True
        )

        if not staff:
            return jsonify({"error": "工号或密码错误"}), 401

        # 生成令牌
        token = generate_token(staff)
        expires_at = datetime.now() + timedelta(hours=8)  # 8小时有效期

        # 存储令牌
        execute_update(
            "INSERT INTO auth_tokens (token, employee_id, expires_at) VALUES (%s, %s, %s)",
            (token, staff['employee_id'], expires_at)
        )

        return jsonify({
            "status": "success",
            "token": token,
            "user_info": {
                "employee_id": staff['employee_id'],
                "full_name": staff['full_name'],
                "role": staff['role']
            }
        })

    except Exception as e:
        logging.error(f"员工登录失败: {str(e)}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500
#------------------ 工作人员控制台登录 ------------------

#新增路由
@app.route('/get_daily_flow', methods=['GET'])
def get_daily_flow():
    try:
        intersection_id = request.args.get('intersection_id')
        date_str = request.args.get('date', datetime.now().strftime("%Y-%m-%d"))

        # 修改参数验证调用方式
        valid, error_response = validate_intersection_id(intersection_id)
        if not valid:
            return error_response[0], error_response[1]
            # 添加空数据保护
            if not date_str:
                return jsonify({
                    "data": [],
                    "update_time": datetime.now().strftime("%H:%M"),
                    "date": date_str
                })

        table_num = int(intersection_id)
        logging.info(f"Querying traffic_flow{table_num} for date {date_str}")

        # 生成24小时空数据模板
        hours = {h: 0 for h in range(24)}

        # 使用参数化查询防止SQL注入
        query = f"""
            SELECT record_hour, SUM(flow_count) as count 
            FROM traffic_flow{table_num}
            WHERE record_date = %s
            GROUP BY record_hour
        """
        records = execute_query(query, (date_str,))

        # 合并数据
        for r in records:
            if 0 <= r['record_hour'] <= 23:
                hours[r['record_hour']] = r['count']

        # 生成图表数据
        chart_data = [
            {"hour": f"{h:02d}:00", "count": hours[h], "full_hour": h}
            for h in sorted(hours.keys())
        ]

        return jsonify({
            "data": chart_data,
            "update_time": datetime.now().strftime("%H:%M"),
            "date": date_str
        })

    except mysql.connector.Error as err:
        logging.error(f"Database error in get_daily_flow: {err}")
        return jsonify({"error": "Database operation failed"}), 500
    except Exception as e:
        logging.error(f"Unexpected error in get_daily_flow: {str(e)}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

#新增流量数据获取接口
@app.route('/get_traffic_flow', methods=['GET'])
def get_traffic_flow():
    try:
        intersection_id = request.args.get('intersection_id')
        date_str = request.args.get('date')  # 新增
        valid, error_response = validate_intersection_id(intersection_id)
        if not valid:
            return error_response

        table_num = int(intersection_id)
        if date_str:
            # 查询指定日期的全天数据
            query = f"""
                SELECT time_period, flow_count, record_date
                FROM traffic_flow{table_num}
                WHERE record_date = %s
                ORDER BY record_hour
            """
            data = execute_query(query, (date_str,))
        else:
            # 查询最近24条
            query = f"SELECT * FROM traffic_flow{table_num} ORDER BY record_date DESC, record_hour DESC LIMIT 24"
            data = execute_query(query)

        return jsonify([{
            "time_period": row["time_period"],
            "flow_count": row["flow_count"],
            "record_date": row["record_date"].strftime("%Y-%m-%d")
        } for row in data])

    except Exception as e:
        logging.error(f"Error in get_traffic_flow: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/flow_dates', methods=['GET'])
def get_available_dates():
    try:
        query = "SELECT DISTINCT record_date FROM traffic_flow1 ORDER BY record_date DESC LIMIT 7"
        dates = execute_query(query)
        return jsonify([d['record_date'].strftime("%Y-%m-%d") for d in dates])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

#路由处理
@app.route('/get_traffic_lights', methods=['GET'])
def handle_get_traffic_lights():
    try:
        intersection_id = request.args.get('intersection_id')
        if not intersection_id or not intersection_id.isdigit():
            return jsonify({"error": "Invalid intersection ID"}), 400

        lights_status = get_traffic_light_status(intersection_id)
        if not lights_status:
            return jsonify({"error": "No data found"}), 404
        return jsonify(lights_status)

    except mysql.connector.Error as err:
        logging.error(f"Database error: {err}")
        return jsonify({"error": "Database operation failed"}), 500
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/get_accident_records', methods=['GET'])
def handle_get_accident_records():
    try:
        intersection_id = request.args.get('intersection_id')
        if not intersection_id or not intersection_id.isdigit():
            return jsonify({"error": "Invalid intersection ID"}), 400

        table_num = int(intersection_id)
        if not 1 <= table_num <= 15:
            return jsonify({"error": "Intersection ID out of range"}), 400

        table_name = f"accident_records{table_num}"
        records = execute_query(f"SELECT id, date, description FROM {table_name} ORDER BY date DESC")
        return jsonify(records if records else [])

    except mysql.connector.Error as err:
        logging.error(f"Database error: {err}")
        return jsonify({"error": "Database operation failed"}), 500
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


#修改原有的/user_feedback路由处理函数
@app.route('/user_feedback', methods=['POST'])
def handle_user_feedback():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "无效的请求格式"}), 400

        # 类型校验
        if data.get('feedback_type') not in ['过路口', '事故发生']:
            return jsonify({"error": "非法的反馈类型"}), 400

        # 字段验证
        required_fields = {
            '过路口': ['intersection_id', 'light_id'],
            '事故发生': ['intersection_id', 'description']
        }[data['feedback_type']]

        if any(field not in data for field in required_fields):
            return jsonify({"error": "缺少必要字段"}), 400

        # 处理逻辑
        if data['feedback_type'] == '过路口':
            success = adjust_traffic_lights(
                int(data['intersection_id']),
                int(data['light_id'])
            )
            if not success:
                return jsonify({
                    "error": "信号灯调整失败",
                    "code": "LIGHT_ADJUST_FAILED"
                }), 503
            return jsonify({"status": "success"})  # 添加成功返回

        else:
            # 检查事故记录表是否存在
            table_name = f"accident_records{data['intersection_id']}"
            if not execute_query(f"SHOW TABLES LIKE '{table_name}'", fetch_one=True):
                return jsonify({"error": "无效的路口ID"}), 400

            # 插入事故记录
            execute_update(
                f"INSERT INTO {table_name} (date, description) VALUES (%s,%s)",
                (datetime.now().date(), data['description'][:255])  # 限制描述长度
            )
            return jsonify({"status": "success"})  # 明确返回

    except Exception as e:
        logging.error(f"处理错误: {traceback.format_exc()}")
        return jsonify({"error": f"系统内部错误: {str(e)}"}), 500




@app.route('/batch_update_traffic_lights', methods=['POST'])
def handle_batch_update():
    try:
        data = request.json
        if not data or 'updates' not in data:
            return jsonify({"error": "Invalid request format"}), 400

        with db_connection() as conn:
            conn.autocommit = False  # 开启事务
            try:
                with conn.cursor() as cursor:
                    for idx, update in enumerate(data['updates'], 1):
                        # 参数验证
                        required = ['intersection_id', 'light_id',
                                    'red_duration', 'green_duration', 'current_status']
                        if not all(key in update for key in required):
                            raise ValueError(f"Missing fields in update #{idx}")

                        # 执行更新
                        cursor.execute("""
                            UPDATE traffic_lights 
                            SET red_duration = %s,
                                green_duration = %s,
                                current_status = %s,
                                last_switch_time = CASE 
                                    WHEN current_status != %s THEN NOW() 
                                    ELSE last_switch_time 
                                END
                            WHERE intersection_id = %s AND light_id = %s
                        """, (
                            int(update['red_duration']),
                            int(update['green_duration']),
                            update['current_status'],
                            update['current_status'],
                            int(update['intersection_id']),
                            int(update['light_id'])
                        ))

                        if cursor.rowcount == 0:
                            raise ValueError(f"Light {update['light_id']} not found")

                    conn.commit()
                    return jsonify({
                        "status": "success",
                        "updated_count": len(data['updates'])
                    })

            except ValueError as ve:
                conn.rollback()
                logging.warning(f"Validation error: {str(ve)}")
                return jsonify({"error": str(ve)}), 400
            except Exception as e:
                conn.rollback()
                logging.error(f"Update error: {str(e)}")
                return jsonify({"error": "Database update failed"}), 500

    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


#新增路由：计算前一天平均车流量（补充到已有路由中）
@app.route('/get_average_flow', methods=['GET'])
def get_average_flow():
    try:
        intersection_id = request.args.get('intersection_id')
        if not intersection_id or not intersection_id.isdigit():
            return jsonify({"error": "Invalid intersection ID"}), 400

        # 计算前一天日期
        yesterday = datetime.now() - timedelta(days=1)
        yesterday_str = yesterday.strftime("%Y-%m-%d")

        # 验证路口ID范围
        table_num = int(intersection_id)
        if not 1 <= table_num <= 15:
            return jsonify({"error": "Intersection ID out of range"}), 400

        # 查询总车流量
        query = f"""
            SELECT SUM(flow_count) AS total_flow 
            FROM traffic_flow{table_num}
            WHERE record_date = %s
        """
        result = execute_query(query, (yesterday_str,), fetch_one=True)

        # 计算平均值
        total = result['total_flow'] if result and result['total_flow'] else 0
        average = round(total / 24, 2)  # 保留两位小数

        return jsonify({
            "status": "success",
            "intersection_id": intersection_id,
            "date": yesterday_str,
            "average_flow": average
        })

    except mysql.connector.Error as err:
        logging.error(f"Database error: {err}")
        return jsonify({"error": "Database operation failed"}), 500
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/get_light_schedule', methods=['GET'])
def get_light_schedule():
    """获取红绿灯排班信息"""
    try:
        intersection_id = request.args.get('intersection_id')
        if not validate_intersection_id(intersection_id)[0]:
            return jsonify({"error": "Invalid intersection ID"}), 400

        query = """
                SELECT light_id, \
                       red_duration, \
                       green_duration,
                       DATE_FORMAT(next_switch_time, '%%H:%%i') AS next_switch
                FROM traffic_lights
                WHERE intersection_id = %s
                ORDER BY light_id \
                """
        schedule = execute_query(query, (intersection_id,))
        return jsonify(schedule)

    except Exception as e:
        logging.error(f"获取排班失败: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/export_traffic_flow', methods=['GET'])
def export_traffic_flow():
    try:
        # 获取请求参数
        intersection_id = request.args.get('intersection_id')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')

        # 参数有效性验证
        if not all([intersection_id, start_date, end_date]):
            return jsonify({"error": "缺少必要参数：intersection_id, start_date, end_date"}), 400

        # 验证路口ID格式
        if not intersection_id.isdigit():
            return jsonify({"error": "路口ID必须为数字"}), 400

        table_num = int(intersection_id)
        if not (1 <= table_num <= 15):
            return jsonify({"error": "路口ID范围应为1-15"}), 400

        # 验证日期格式
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            if start_dt > end_dt:
                return jsonify({"error": "开始日期不能晚于结束日期"}), 400
        except ValueError:
            return jsonify({"error": "日期格式应为YYYY-MM-DD"}), 400

        # 限制最大查询范围（30天）
        if (end_dt - start_dt).days > 30:
            return jsonify({"error": "最多支持导出30天的数据"}), 400

        # 数据库查询
        query = f"""
            SELECT record_date, record_hour, time_period, flow_count
            FROM traffic_flow{table_num}
            WHERE record_date BETWEEN %s AND %s
            ORDER BY record_date, record_hour
        """
        data = execute_query(query, (start_date, end_date))

        # 处理空数据情况
        if not data:
            return jsonify({"error": "选定时间段内没有数据"}), 404

        # 创建Excel文件
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "交通流量数据"

        # 设置表头
        headers = ["日期", "小时", "时间段", "车流量（辆/小时）"]
        ws.append(headers)

        # 设置列宽
        ws.column_dimensions['A'].width = 12
        ws.column_dimensions['B'].width = 8
        ws.column_dimensions['C'].width = 15
        ws.column_dimensions['D'].width = 18

        # 填充数据
        for record in data:
            ws.append([
                record['record_date'].strftime('%Y-%m-%d'),
                record['record_hour'],
                record['time_period'],
                record['flow_count']
            ])

        # 创建内存文件
        output = BytesIO()
        wb.save(output)
        output.seek(0)  # 关键步骤：重置指针位置

        # 生成安全文件名
        safe_filename = f"traffic_flow_{table_num}_{start_date.replace('-', '')}_{end_date.replace('-', '')}.xlsx"

        # 构建响应
        response = send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=safe_filename,
            conditional=True
        )

        # 设置响应头
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Access-Control-Expose-Headers'] = 'Content-Disposition'
        response.headers['Cache-Control'] = 'no-store, max-age=0'
        response.headers['Pragma'] = 'no-cache'

        return response

    except mysql.connector.Error as db_err:
        logging.error(f"数据库错误：{str(db_err)}")
        return jsonify({"error": "数据库操作失败"}), 500
    except openpyxl.utils.exceptions.InvalidFileException as e:
        logging.error(f"Excel文件生成错误：{str(e)}")
        return jsonify({"error": "文件生成失败"}), 500
    except Exception as e:
        logging.error(f"未知错误：{str(e)}\n{traceback.format_exc()}")
        return jsonify({"error": "服务器内部错误"}), 500

@app.route('/export_traffic_chart', methods=['GET'])
def export_traffic_chart():
    intersection_id = request.args.get('intersection_id')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    valid, error_response = validate_intersection_id(intersection_id)
    if not valid:
        return error_response

    table_num = int(intersection_id)
    query = f"""
        SELECT record_date, record_hour, flow_count
        FROM traffic_flow{table_num}
        WHERE record_date >= %s AND record_date <= %s
        ORDER BY record_date, record_hour
    """
    data = execute_query(query, (start_date, end_date))

    # 组织数据
    x_labels = []
    y_values = []
    for row in data:
        x_labels.append(f"{row['record_date'].strftime('%Y-%m-%d')} {row['record_hour']:02d}:00")
        y_values.append(row['flow_count'])

    # 绘图
    plt.figure(figsize=(max(8, len(x_labels)//6), 4))
    plt.plot(x_labels, y_values, marker='o')
    plt.xticks(rotation=45, fontsize=8)
    plt.xlabel('时间')
    plt.ylabel('流量')
    plt.title(f'路口{intersection_id} 车流量趋势')
    plt.tight_layout()

    # 输出为图片
    output = BytesIO()
    plt.savefig(output, format='png')
    plt.close()
    output.seek(0)

    filename = f"traffic_chart_{intersection_id}_{start_date}_to_{end_date}.png"
    return send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype='image/png'
    )



if __name__ == '__main__':
    schedule_jobs()  # 确保定时任务启动
    app.run(host='0.0.0.0', port=5000, debug=False)