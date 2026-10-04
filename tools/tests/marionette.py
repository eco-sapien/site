"""Minimal local Firefox Marionette driver used by the optional UI checks."""
import base64
import json
import socket
from pathlib import Path

class Browser:
    def __init__(self):
        self.sock=socket.create_connection(('127.0.0.1',2828),timeout=15)
        self.buf=b''; self.seq=0
        self.receive()
        self.call('WebDriver:NewSession',{'capabilities':{'alwaysMatch':{'acceptInsecureCerts':True}}})
    def receive(self):
        while b':' not in self.buf:self.buf+=self.sock.recv(65536)
        size,rest=self.buf.split(b':',1);n=int(size)
        while len(rest)<n:rest+=self.sock.recv(65536)
        self.buf=rest[n:]
        return json.loads(rest[:n])
    def call(self,name,params=None):
        self.seq+=1
        data=json.dumps([0,self.seq,name,params or {}]).encode()
        self.sock.sendall(str(len(data)).encode()+b':'+data)
        while True:
            response=self.receive()
            if response[0]==1 and response[1]==self.seq:
                if response[2]:raise RuntimeError(response[2])
                return response[3]
    def script(self,script):
        r=self.call('WebDriver:ExecuteScript',{'script':script,'args':[],'newSandbox':False,'sandbox':None})
        return r.get('value',r) if isinstance(r,dict) else r
    def check(self,label,script):
        result=self.script(script)
        assert result is True,(label,result)
        print('PASS',label,flush=True)
    def screenshot(self,name):
        r=self.call('WebDriver:TakeScreenshot',{'full':False})
        if isinstance(r,dict):r=r['value']
        Path('/tmp/'+name).write_bytes(base64.b64decode(r))
