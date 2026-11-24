import csv
import hashlib
import hmac
import io
import os
import secrets
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import psycopg
from psycopg.rows import dict_row
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://useradmin:useradmin@localhost:5432/useradmin')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'Admin@123456')
COOKIE_SECURE = os.getenv('COOKIE_SECURE', 'false').lower() == 'true'
ROLES = {'admin': '管理员', 'member': '普通成员', 'viewer': '只读成员'}


@contextmanager
def db():
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn


def audit(conn, action, detail):
    conn.execute('INSERT INTO activities (action, detail, actor) VALUES (%s, %s, %s)',
                 (action, detail, ADMIN_USERNAME))


def initialize():
    with db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(254) NOT NULL,
            department VARCHAR(80) NOT NULL DEFAULT '', role VARCHAR(20) NOT NULL
                CHECK (role IN ('admin','member','viewer')),
            status VARCHAR(20) NOT NULL CHECK (status IN ('active','disabled')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())''')
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email))')
        conn.execute('''CREATE TABLE IF NOT EXISTS activities (
            id BIGSERIAL PRIMARY KEY, action TEXT NOT NULL, detail TEXT NOT NULL,
            actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())''')
        conn.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL)''')
        conn.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
            client TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
            window_start TIMESTAMPTZ NOT NULL DEFAULT NOW())''')
        conn.execute('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY)')
        seeded = conn.execute("INSERT INTO app_meta (key) VALUES ('initialized') ON CONFLICT DO NOTHING RETURNING key").fetchone()
        if seeded and os.getenv('SEED_DEMO', 'false').lower() == 'true':
            people = [('林晓','lin.xiao@example.com','产品设计','admin','active'),
                      ('陈思远','chen.siyuan@example.com','研发中心','admin','active'),
                      ('周予安','zhou.yuan@example.com','市场营销','member','active'),
                      ('许知夏','xu.zhixia@example.com','产品设计','member','active'),
                      ('王亦辰','wang.yichen@example.com','研发中心','member','disabled'),
                      ('苏念','su.nian@example.com','人力资源','viewer','active'),
                      ('陆景行','lu.jingxing@example.com','运营支持','member','active'),
                      ('沈清禾','shen.qinghe@example.com','财务管理','viewer','disabled')]
            for p in people:
                conn.execute('INSERT INTO users (name,email,department,role,status) VALUES (%s,%s,%s,%s,%s)', p)
            audit(conn, '系统初始化', '已创建 8 位演示用户')


@asynccontextmanager
async def lifespan(app):
    for attempt in range(30):
        try:
            initialize()
            break
        except psycopg.OperationalError:
            if attempt == 29:
                raise
            time.sleep(1)
    yield


app = FastAPI(title='Orbit 用户管理 API', lifespan=lifespan)


def require_admin(request: Request):
    token = request.cookies.get('orbit_session', '')
    if not token:
        raise HTTPException(401, '请先登录')
    with db() as conn:
        session = conn.execute('SELECT 1 FROM sessions WHERE token_hash=%s AND expires_at>NOW()',
                               (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not session:
        raise HTTPException(401, '登录已过期，请重新登录')
    # Session cookies are HttpOnly and SameSite=Strict; also reject cross-origin writes.
    origin = request.headers.get('origin')
    if request.method not in ('GET', 'HEAD') and origin and origin != str(request.base_url).rstrip('/'):
        raise HTTPException(403, '不允许跨域操作')


class Login(BaseModel):
    username: str = Field(max_length=80)
    password: str = Field(max_length=200)


class UserInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    department: str = Field(default='', max_length=80)
    role: Literal['admin', 'member', 'viewer'] = 'member'
    status: Literal['active', 'disabled'] = 'active'

    @field_validator('name', 'email', 'department', mode='before')
    @classmethod
    def strip_strings(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        import re
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('请输入有效的邮箱地址')
        return value.lower()


class BulkInput(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)
    action: Literal['activate', 'disable', 'delete']


@app.get('/api/health')
def health():
    with db() as conn:
        conn.execute('SELECT 1')
    return {'status': 'ok', 'database': 'postgresql'}


@app.post('/api/auth/login')
def login(body: Login, request: Request, response: Response):
    client = request.client.host if request.client else 'unknown'
    with db() as conn:
        conn.execute("DELETE FROM login_attempts WHERE window_start < NOW() - INTERVAL '15 minutes'")
        attempt = conn.execute('''INSERT INTO login_attempts (client, attempts) VALUES (%s, 1)
            ON CONFLICT (client) DO UPDATE SET attempts=login_attempts.attempts+1 RETURNING attempts''', (client,)).fetchone()
    if attempt['attempts'] > 10:
        raise HTTPException(429, '登录尝试过多，请在 15 分钟后重试')
    if not (hmac.compare_digest(body.username.encode(), ADMIN_USERNAME.encode()) and
            hmac.compare_digest(body.password.encode(), ADMIN_PASSWORD.encode())):
        raise HTTPException(401, '用户名或密码不正确')
    token = secrets.token_urlsafe(48)
    with db() as conn:
        conn.execute('DELETE FROM sessions WHERE expires_at<NOW()')
        conn.execute('DELETE FROM login_attempts WHERE client=%s', (client,))
        conn.execute('INSERT INTO sessions VALUES (%s,%s)',
                     (hashlib.sha256(token.encode()).hexdigest(), datetime.now(timezone.utc) + timedelta(hours=8)))
        audit(conn, '管理员登录', f'{ADMIN_USERNAME} 登录了管理后台')
    response.set_cookie('orbit_session', token, httponly=True, secure=COOKIE_SECURE, samesite='strict', max_age=28800)
    return {'username': ADMIN_USERNAME}


@app.get('/api/auth/me', dependencies=[Depends(require_admin)])
def me():
    return {'username': ADMIN_USERNAME}


@app.post('/api/auth/logout', dependencies=[Depends(require_admin)])
def logout(request: Request, response: Response):
    with db() as conn:
        conn.execute('DELETE FROM sessions WHERE token_hash=%s',
                     (hashlib.sha256(request.cookies['orbit_session'].encode()).hexdigest(),))
    response.delete_cookie('orbit_session')
    return {'ok': True}


def filters(q='', role='', status=''):
    clauses, args = [], []
    if q:
        clauses.append('(name ILIKE %s OR email ILIKE %s OR department ILIKE %s)')
        # Treat LIKE wildcards as literal search characters.
        pattern = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        args.extend([pattern] * 3)
    if role:
        clauses.append('role=%s')
        args.append(role)
    if status:
        clauses.append('status=%s')
        args.append(status)
    return (' WHERE ' + ' AND '.join(clauses) if clauses else ''), args


@app.get('/api/stats', dependencies=[Depends(require_admin)])
def stats():
    with db() as conn:
        return conn.execute('''SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status='active') AS active,
            COUNT(*) FILTER (WHERE role='admin') AS admins,
            COUNT(*) FILTER (WHERE created_at>=DATE_TRUNC('month',NOW())) AS new_this_month FROM users''').fetchone()


@app.get('/api/users', dependencies=[Depends(require_admin)])
def list_users(q: str = Query('', max_length=100), role: str = '', status: str = '',
               page: int = Query(1, ge=1), page_size: int = Query(8, ge=1, le=100)):
    where, args = filters(q, role, status)
    with db() as conn:
        total = conn.execute('SELECT COUNT(*) AS n FROM users' + where, args).fetchone()['n']
        rows = conn.execute('SELECT * FROM users' + where + ' ORDER BY id DESC LIMIT %s OFFSET %s',
                            [*args, page_size, (page - 1) * page_size]).fetchall()
    return {'items': rows, 'total': total, 'page': page, 'page_size': page_size}


@app.get('/api/users/export', dependencies=[Depends(require_admin)])
def export_users(q: str = Query('', max_length=100), role: str = '', status: str = ''):
    where, args = filters(q, role, status)
    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(['ID', '姓名', '邮箱', '部门', '角色', '状态', '创建时间'])
        yield '\ufeff' + buf.getvalue()
        with db() as conn:
            with conn.cursor(name='export_users') as cursor:
                cursor.execute('SELECT * FROM users' + where + ' ORDER BY id DESC', args)
                for u in cursor:
                    buf.seek(0)
                    buf.truncate(0)
                    def safe(value):
                        s = str(value)
                        return "'" + s if s.startswith(('=', '+', '-', '@', '\t', '\r')) else s
                    writer.writerow([safe(v) for v in [u['id'], u['name'], u['email'], u['department'],
                        ROLES[u['role']], '正常' if u['status'] == 'active' else '已停用', u['created_at'].isoformat()]])
                    yield buf.getvalue()
    return StreamingResponse(generate(), media_type='text/csv; charset=utf-8',
                             headers={'Content-Disposition': 'attachment; filename="users.csv"'})


@app.post('/api/users', status_code=201, dependencies=[Depends(require_admin)])
def create_user(body: UserInput):
    try:
        with db() as conn:
            user = conn.execute('INSERT INTO users (name,email,department,role,status) VALUES (%s,%s,%s,%s,%s) RETURNING *',
                                (body.name, body.email, body.department, body.role, body.status)).fetchone()
            audit(conn, '创建用户', f'创建了用户 {body.name}（{body.email}）')
            return user
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, '该邮箱已被使用')


@app.put('/api/users/{user_id}', dependencies=[Depends(require_admin)])
def update_user(user_id: int, body: UserInput):
    try:
        with db() as conn:
            user = conn.execute('''UPDATE users SET name=%s,email=%s,department=%s,role=%s,status=%s,
                updated_at=NOW() WHERE id=%s RETURNING *''',
                (body.name, body.email, body.department, body.role, body.status, user_id)).fetchone()
            if not user:
                raise HTTPException(404, '用户不存在')
            audit(conn, '更新用户', f'更新了用户 {body.name} 的资料')
            return user
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, '该邮箱已被使用')


@app.delete('/api/users/{user_id}', dependencies=[Depends(require_admin)])
def delete_user(user_id: int):
    with db() as conn:
        user = conn.execute('DELETE FROM users WHERE id=%s RETURNING name', (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, '用户不存在')
        audit(conn, '删除用户', f'删除了用户 {user["name"]}')
    return {'ok': True}


@app.post('/api/users/bulk', dependencies=[Depends(require_admin)])
def bulk_users(body: BulkInput):
    with db() as conn:
        if body.action == 'delete':
            result = conn.execute('DELETE FROM users WHERE id=ANY(%s)', (body.ids,))
        else:
            result = conn.execute('UPDATE users SET status=%s,updated_at=NOW() WHERE id=ANY(%s)',
                                  ('active' if body.action == 'activate' else 'disabled', body.ids))
        count = result.rowcount
        audit(conn, '批量操作', f'{ {"delete":"删除", "activate":"启用", "disable":"停用"}[body.action]}了 {count} 位用户')
    return {'affected': count}


@app.get('/api/activities', dependencies=[Depends(require_admin)])
def activities(page: int = Query(1, ge=1), page_size: int = Query(15, ge=1, le=100)):
    with db() as conn:
        rows = conn.execute('SELECT * FROM activities ORDER BY id DESC LIMIT %s OFFSET %s',
                            (page_size, (page - 1) * page_size)).fetchall()
        total = conn.execute('SELECT COUNT(*) AS n FROM activities').fetchone()['n']
    return {'items': rows, 'total': total}


STATIC_DIR = Path(os.getenv('STATIC_DIR', str(Path(__file__).parent / 'static')))
if STATIC_DIR.exists():
    app.mount('/assets', StaticFiles(directory=STATIC_DIR / 'assets'), name='assets')

    @app.get('/{path:path}')
    def frontend(path: str):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404, '接口不存在')
        return FileResponse(STATIC_DIR / 'index.html')
