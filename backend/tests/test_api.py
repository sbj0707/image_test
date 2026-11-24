"""Integration tests against a running app and a real PostgreSQL database."""
import csv
import io
import json
import os
import unittest
import uuid
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE = os.getenv('TEST_URL', 'http://localhost:8080')


class UserManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = build_opener(HTTPCookieProcessor(CookieJar()))
        cls.ids = []
        cls.prefix = 'test-' + uuid.uuid4().hex[:10]
        status, _ = cls.call('POST', '/auth/login', {
            'username': os.getenv('ADMIN_USERNAME', 'admin'),
            'password': os.getenv('ADMIN_PASSWORD', 'Admin@123456')})
        if status != 200:
            raise RuntimeError('Unable to log in to test server')

    @classmethod
    def call(cls, method, path, data=None, client=None, headers=None):
        request = Request(BASE + '/api' + path,
                          data=json.dumps(data).encode() if data is not None else None,
                          method=method, headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            response = (client or cls.client).open(request)
        except HTTPError as error:
            response = error
        body = response.read().decode('utf-8-sig')
        return response.status, json.loads(body) if 'application/json' in response.headers.get('Content-Type', '') else body

    @classmethod
    def tearDownClass(cls):
        if cls.ids:
            cls.call('POST', '/users/bulk', {'ids': cls.ids, 'action': 'delete'})
        cls.call('POST', '/auth/logout')

    def new_user(self, suffix, **overrides):
        data = dict(name=self.prefix + suffix, email=self.prefix + suffix + '@example.com',
                    department='测试部门', role='member', status='active')
        data.update(overrides)
        code, user = self.call('POST', '/users', data)
        self.assertEqual(code, 201, user)
        self.ids.append(user['id'])
        return user

    def test_authentication_and_logout(self):
        anonymous = build_opener()
        self.assertEqual(self.call('GET', '/users', client=anonymous)[0], 401)
        self.assertEqual(self.call('POST', '/auth/login', {'username': 'admin', 'password': 'wrong'}, client=anonymous)[0], 401)
        separate = build_opener(HTTPCookieProcessor(CookieJar()))
        code, _ = self.call('POST', '/auth/login', {'username': os.getenv('ADMIN_USERNAME', 'admin'),
                              'password': os.getenv('ADMIN_PASSWORD', 'Admin@123456')}, client=separate)
        self.assertEqual(code, 200)
        self.assertEqual(self.call('GET', '/auth/me', client=separate)[0], 200)
        self.assertEqual(self.call('POST', '/auth/logout', client=separate)[0], 200)
        self.assertEqual(self.call('GET', '/auth/me', client=separate)[0], 401)

    def test_crud_and_audit(self):
        user = self.new_user('crud')
        update = {**user, 'name': self.prefix + '-updated', 'role': 'viewer', 'status': 'disabled'}
        code, saved = self.call('PUT', f'/users/{user["id"]}', update)
        self.assertEqual(code, 200)
        self.assertEqual(saved['role'], 'viewer')
        code, result = self.call('GET', '/users?q=' + self.prefix + '-updated&role=viewer&status=disabled')
        self.assertEqual(code, 200)
        self.assertEqual(result['total'], 1)
        self.assertEqual(self.call('DELETE', f'/users/{user["id"]}')[0], 200)
        self.assertEqual(self.call('DELETE', f'/users/{user["id"]}')[0], 404)
        logs = self.call('GET', '/activities?page_size=100')[1]['items']
        self.assertTrue(any(self.prefix + '-updated' in event['detail'] for event in logs))

    def test_validation_and_unique_email(self):
        user = self.new_user('unique')
        self.assertEqual(self.call('POST', '/users', {**user, 'email': user['email'].upper()})[0], 409)
        self.assertEqual(self.call('POST', '/users', {**user, 'email': 'invalid'})[0], 422)
        self.assertEqual(self.call('POST', '/users', {**user, 'name': '  '})[0], 422)
        self.assertEqual(self.call('PUT', f'/users/{user["id"]}', {**user, 'role': 'superuser'})[0], 422)
        self.assertEqual(self.call('GET', '/users?page=0')[0], 422)

    def test_bulk_and_pagination(self):
        users = [self.new_user('bulk' + str(i)) for i in range(3)]
        ids = [u['id'] for u in users]
        for action, status in [('disable', 'disabled'), ('activate', 'active')]:
            self.assertEqual(self.call('POST', '/users/bulk', {'ids': ids, 'action': action})[1]['affected'], 3)
            data = self.call('GET', '/users?q=' + self.prefix + 'bulk&status=' + status + '&page_size=2&page=2')[1]
            self.assertEqual(data['total'], 3)
            self.assertEqual(len(data['items']), 1)
        self.assertEqual(self.call('POST', '/users/bulk', {'ids': ids, 'action': 'delete'})[1]['affected'], 3)

    def test_export_and_literal_search(self):
        user = self.new_user('export', name='=HYPERLINK("example.com")')
        code, content = self.call('GET', '/users/export?q=' + self.prefix + 'export')
        self.assertEqual(code, 200)
        rows = list(csv.reader(io.StringIO(content)))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1][1], "'" + user['name'])
        self.assertEqual(self.call('GET', '/users?q=%25')[1]['total'], 0)
        self.assertEqual(self.call('GET', '/users?q=%27%20OR%201=1--')[1]['total'], 0)

    def test_stats_and_health(self):
        self.assertEqual(self.call('GET', '/health')[1]['database'], 'postgresql')
        stats = self.call('GET', '/stats')[1]
        self.assertGreaterEqual(stats['total'], stats['active'])
        self.assertGreaterEqual(stats['total'], stats['admins'])

    def test_cross_origin_mutation_rejected(self):
        self.assertEqual(self.call('POST', '/users', empty_user(), headers={'Origin': 'https://other.example'})[0], 403)


def empty_user():
    return {'name': 'blocked', 'email': 'blocked@example.com'}


if __name__ == '__main__':
    unittest.main()
