# -*- coding: utf-8 -*-
"""Exercise the real interactive setup in an owned temporary TTY, never user data."""
import os, pty, subprocess, tempfile, select, time, re, hmac, hashlib, base64, struct
from pathlib import Path
script = str(Path(__file__).resolve().with_name('auth-setup.mjs'))
node = subprocess.check_output(['which','node'], text=True).strip()
with tempfile.TemporaryDirectory(prefix='leneu-auth-tty-') as directory:
    env = {k:v for k,v in os.environ.items() if k not in ['AUTH_SECRET_KEY','AUTH_MODE','AUTH_COOKIE_SECURE','DATA_DIR','NODE_ENV','HOST']}
    env.update(DATA_DIR=directory+'/data',HOST='127.0.0.1')
    Path(directory,'.env').write_text(Path(script).parent.parent.joinpath('.env.example').read_text())
    master,slave=pty.openpty()
    child=subprocess.Popen([node,'--env-file-if-exists=.env',script],cwd=directory,env=env,stdin=slave,stdout=slave,stderr=slave,close_fds=True)
    os.close(slave)
    transcript=b''
    def until(marker):
        global transcript
        deadline=time.monotonic()+15
        while marker.encode() not in transcript:
            if time.monotonic()>deadline: raise AssertionError('interactive prompt timed out')
            if select.select([master],[],[],.1)[0]:
                try: data=os.read(master,4096)
                except OSError: break
                if not data: break
                transcript+=data
        assert marker.encode() in transcript, 'prompt missing'
    try:
        until('비밀번호 (12자 이상):')
        password='private tty fixture password!'
        os.write(master,(password+'\n').encode())
        until('비밀번호 다시 입력:')
        os.write(master,(password+'\n').encode())
        until('앱의 6자리 인증 코드:')
        text=transcript.decode(errors='replace')
        secret=re.search(r'설정 키: ([A-Z2-7]{32})',text).group(1)
        hashed=hmac.new(base64.b32decode(secret),struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest()
        offset=hashed[-1]&15
        code=str((struct.unpack('>I',hashed[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
        os.write(master,(code+'\n').encode())
        until('서버를 재시작한 뒤')
        child.wait(timeout=10)
        assert child.returncode==0
        assert password.encode() not in transcript, 'password echoed'
        codes=re.findall(r'(?:\r?\n)([a-f0-9]{24})(?:\r?\n)',transcript.decode(errors='replace'))
        # Adjacent lines share a delimiter, so inspect lines individually instead.
        codes=[line.strip() for line in transcript.decode(errors='replace').splitlines() if re.fullmatch('[a-f0-9]{24}',line.strip())]
        assert len(codes)==10
        path=Path(directory)/'.env';data=path.read_text()
        assert 'AUTH_MODE=required' in data and re.search('AUTH_SECRET_KEY=[a-f0-9]{64}',data)
        assert path.stat().st_mode&0o777==0o600
        refusal=subprocess.run([node,'--env-file-if-exists=.env',script],cwd=directory,env=env,capture_output=True,text=True)
        assert refusal.returncode==1 and '대화형 터미널' in refusal.stderr
        print('PASS real setup TTY: hidden password, confirmed Authenticator, ten recovery codes,0600 env; non-TTY refused. Temporary data removed.')
    finally:
        if child.poll() is None: child.kill(); child.wait()
        os.close(master)
