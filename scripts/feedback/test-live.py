"""Opt-in integration check. Creates and deletes one isolated test Auth user.
Usage: python3 scripts/feedback/test-live.py PROJECT_REF
Requires Supabase CLI login. Never prints or persists API keys. Email content is
explicitly labeled as a test if a provider has already been configured.
"""
import json, secrets, subprocess, sys, time, urllib.request, urllib.error, uuid
ref = sys.argv[1]
base = f'https://{ref}.supabase.co'
keys = json.loads(subprocess.run(['pnpm', 'exec', 'supabase', 'projects', 'api-keys', '--project-ref', ref, '--output', 'json'], capture_output=True, text=True, check=True).stdout)
admin = next(item['api_key'] for item in keys if item['name'] == 'service_role')
anon = next(item['api_key'] for item in keys if item['name'] == 'anon')
def call(path, payload=None, token=None, method=None, key=anon):
    headers = {'apikey': key, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token or key)}
    req = urllib.request.Request(base + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read(); return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read(); return error.code, json.loads(raw) if raw else None
user_id = None
try:
    email = 'feedback-test-' + uuid.uuid4().hex + '@example.com'
    password = secrets.token_urlsafe(32)
    code, user = call('/auth/v1/admin/users', {'email': email, 'password': password, 'email_confirm': True}, key=admin)
    assert code in (200, 201), ('create test user', code)
    user_id = user['id']
    code, login = call('/auth/v1/token?grant_type=password', {'email': email, 'password': password})
    assert code == 200, ('login', code)
    token = login['access_token']
    body = {'request_id': str(uuid.uuid4()), 'category': 'other', 'message': '[Automated integration test] Feedback reliability check; safe to ignore.', 'contact_email': '', 'app_version': 'integration-test', 'platform': 'web'}
    endpoint = '/functions/v1/submit-feedback'
    code, _ = call(endpoint, body)
    assert code == 401, ('anonymous request', code)
    for patch in [{'message': '  \n\t'}, {'message': 'x' * 1501}, {'contact_email': 'bad@'}, {'user_id': str(uuid.uuid4())}, {'status': 'closed'}]:
        code, _ = call(endpoint, dict(body, **patch), token)
        assert code == 400, ('invalid request', code)
    code, result = call(endpoint, body, token)
    assert code == 200, ('submit', code, result)
    assert result['message'] == 'Your suggestion has been sent to the team.'
    code, retry = call(endpoint, body, token)
    assert code == 200 and retry['id'] == result['id'], ('duplicate retry', code)
    for path, method, payload in [('/rest/v1/feedback?select=id', 'GET', None), ('/rest/v1/feedback?id=eq.' + result['id'], 'PATCH', {'status': 'closed'}), ('/rest/v1/feedback?id=eq.' + result['id'], 'DELETE', None)]:
        code, _ = call(path, payload, token, method)
        assert code == 403, ('restricted table access', method, code)
    code, _ = call('/rest/v1/feedback', {'request_id': str(uuid.uuid4()), 'category': 'other', 'message': 'spoof', 'user_id': str(uuid.uuid4())}, token)
    assert code == 403, ('direct user spoof', code)
    code, _ = call('/functions/v1/notify-feedback', {}, token)
    assert code == 401, ('worker access', code)
    for _ in range(10):
        code, rows = call('/rest/v1/feedback?user_id=eq.' + user_id, key=admin)
        assert code == 200 and len(rows) == 1, ('stored once', code)
        if rows[0]['notification_attempts'] > 0 and rows[0]['notification_locked_until'] is None: break
        time.sleep(1)
    row = rows[0]
    assert row['user_id'] == user_id and row['status'] == 'new' and row['contact_email'] is None
    assert row['notification_attempts'] >= 1, 'server-side notification was not triggered'
    assert row['notification_sent_at'] or row['notification_error'], 'delivery outcome not recorded'
    print('PASS: live authenticated save, validation, identity, RLS, retry deduplication, protected worker, server notification attempt, saved feedback survives email failure.')
    print('Notification state:', 'provider accepted' if row['notification_sent_at'] else row['notification_error'])
finally:
    if user_id:
        code, _ = call('/rest/v1/feedback?user_id=eq.' + user_id, method='DELETE', key=admin)
        assert code in (200, 204), ('test feedback cleanup', code)
        code, _ = call('/auth/v1/admin/users/' + user_id, method='DELETE', key=admin)
        assert code in (200, 204), ('test user cleanup', code)
        print('Removed isolated test feedback and Auth user.')
