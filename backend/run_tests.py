import os
import sys

sys.path.insert(0, r'D:\Infranex BT\infranex-bt\backend')
os.chdir(r'D:\Infranex BT\infranex-bt\backend')
import pytest

pytest.main(['tests/gpu_engine/test_gpu_install_routes.py', '-v'])