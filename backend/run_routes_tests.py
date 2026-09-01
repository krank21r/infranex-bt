import subprocess
import sys

result = subprocess.run([sys.executable, '-m', 'pytest', 'tests/gpu_engine/test_gpu_install_routes.py', '-v', '--tb=short'], 
                       cwd='D:\\Infranex BT\\infranex-bt\\backend', capture_output=True, text=True)
print('STDOUT:')
print(result.stdout)
print('STDERR:')
print(result.stderr)
print('Return code:', result.returncode)