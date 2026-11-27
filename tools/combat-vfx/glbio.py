import json, struct, numpy as np
CT={5126:np.float32,5123:np.uint16,5125:np.uint32,5121:np.uint8,5122:np.int16}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def load(p):
    b=open(p,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); return j,b[20+l+8:]
def acc(j,b,i):
    a=j['accessors'][i]; v=j['bufferViews'][a['bufferView']]; off=v.get('byteOffset',0)+a.get('byteOffset',0)
    dt=CT[a['componentType']]; n=NC[a['type']]; cnt=a['count']
    arr=np.frombuffer(b,dtype=dt,count=cnt*n,offset=off).reshape(cnt,n).astype(np.float64)
    if a.get('normalized'):
        arr = arr/ {np.int16:32767.,np.uint16:65535.,np.uint8:255.}[dt]
    return arr
def qmul(a,b):
    x1,y1,z1,w1=a; x2,y2,z2,w2=b
    return np.array([w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2])
def qinv(q): return np.array([-q[0],-q[1],-q[2],q[3]])/np.dot(q,q)
def qrot(q,v):
    p=np.array([v[0],v[1],v[2],0.]); return qmul(qmul(q,p),qinv(q))[:3]
def qaxis(ax,ang):
    ax=np.asarray(ax,float); ax=ax/np.linalg.norm(ax); s=np.sin(ang/2); return np.array([ax[0]*s,ax[1]*s,ax[2]*s,np.cos(ang/2)])
def norm(q): return q/np.linalg.norm(q)
class Skel:
    def __init__(s,path):
        j,b=load(path); s.j=j; s.b=b; N=j['nodes']; sk=j['skins'][0]
        s.joints=sk['joints']; s.names=[N[i]['name'] for i in s.joints]
        idx={n:k for k,n in enumerate(s.joints)}
        s.parent=[-1]*len(s.joints)
        for k,i in enumerate(s.joints):
            for c in N[i].get('children',[]):
                if c in idx: s.parent[idx[c]]=k
        s.T=[np.array(N[i].get('translation',[0,0,0]),float) for i in s.joints]
        s.R=[np.array(N[i].get('rotation',[0,0,0,1]),float) for i in s.joints]
        s.id={n:k for k,n in enumerate(s.names)}
    def fk(s,R=None,T=None):
        R=R or s.R; T=T or s.T; n=len(R); WR=[None]*n; WT=[None]*n
        for k in range(n):
            p=s.parent[k]
            if p<0: WR[k]=R[k]; WT[k]=T[k]
            else: WR[k]=norm(qmul(WR[p],R[k])); WT[k]=WT[p]+qrot(WR[p],T[k])
        return WR,WT
