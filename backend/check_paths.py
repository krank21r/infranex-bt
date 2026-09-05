from app.main import app
from fastapi.testclient import TestClient

c = TestClient(app)
r = c.get('/openapi.json')
paths = list(r.json()['paths'].keys())
for p in paths:
    if 'gpu-engine' in p:
        print(p)