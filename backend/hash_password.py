"""生成 LOGIN_PASSWORD_HASH（pbkdf2_sha256），用法：python hash_password.py 你的密码"""
import sys
from passlib.hash import pbkdf2_sha256

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python hash_password.py 你的密码")
        sys.exit(1)
    pwd = (sys.argv[1] or "").strip()
    if not pwd:
        print("密码不能为空")
        sys.exit(1)
    print(pbkdf2_sha256.hash(pwd))
