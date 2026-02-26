"""生成 LOGIN_PASSWORD_HASH，用法：python hash_password.py 你的密码"""
import sys
from passlib.hash import bcrypt

if __name__ == "__main__":
    pwd = (sys.argv[1] or "").strip()
    if not pwd:
        print("用法: python hash_password.py 你的密码")
        sys.exit(1)
    print(bcrypt.hash(pwd))
