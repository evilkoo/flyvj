(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FlyVJKinectBridge=factory();})(globalThis,function(){
  'use strict';
  // Credentials live only in this closure, never in diagnostics or callback payloads.
  return class FlyVJKinectBridge {
    constructor(options={}) {
      const origin=options.origin||(typeof location!=='undefined'?location.origin:'');
      const enabled=/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(origin);
      const fetcher=options.fetch||globalThis.fetch;
      const later=options.setTimeout||globalThis.setTimeout, cancel=options.clearTimeout||globalThis.clearTimeout;
      const deadlineLater=options.setRequestTimeout||later, deadlineCancel=options.clearRequestTimeout||cancel;
      const Controller=options.AbortController||globalThis.AbortController;
      const requestedTimeout=options.requestTimeoutMs;
      const timeoutMs=Number.isFinite(requestedTimeout)&&requestedTimeout>0?Math.min(requestedTimeout,3000):3000;
      let token=null,session=null,epoch=0,timer=null,pending=null,stopping=null,lastTime=0;
      let view={state:enabled?'off':'disabled',active:false,device:null,error:null};
      const publish=(state,active,error=null,device=null)=>{view={state,active,error,device};if(options.onState)options.onState({...view});};
      const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
      const fail=e=>publish(e&&e.invalid?'error':'unknown',null,e&&e.invalid?'INVALID_MIC_SNAPSHOT':'CAPTURE_STOP_UNCONFIRMED');
      const invalid=()=>{const e=new Error('INVALID_MIC_SNAPSHOT');e.invalid=true;throw e;};
      const device=d=>d&&Number.isInteger(d.index)&&d.index>=0&&typeof d.name==='string'&&/azure\s+kinect/i.test(d.name);
      const validate=s=>{
        if(!s||!['off','running','error'].includes(s.state)||typeof s.active!=='boolean'||(s.state==='off'&&s.active)||(s.state==='running'&&!s.active)||s.sample_rate!==48000||s.frame_size!==2048||!Number.isInteger(s.frames)||s.frames<0||!Number.isFinite(s.time)||s.time<0||Math.abs(s.time-s.frames*2048/48000)>1e-6||!Number.isFinite(s.rms)||s.rms<0||s.rms>1||!s.bands||!['low','mid','high'].every(k=>Number.isFinite(s.bands[k])&&s.bands[k]>=0&&s.bands[k]<=1)||typeof s.clipping!=='boolean'||(s.active&&!device(s.device)))invalid();
        return {state:s.state,active:s.active,device:device(s.device)?{index:s.device.index,name:s.device.name.slice(0,160)}:null,time:s.time,rms:s.rms,bands:{low:s.bands.low,mid:s.bands.mid,high:s.bands.high},clipping:s.clipping,frames:s.frames,sample_rate:48000,frame_size:2048};
      };
      const request=async(path,body,mic)=>{
        const headers={};if(token)headers['X-FlyVJ-Token']=token;if(mic)headers['X-FlyVJ-Mic']=mic;
        if(body!==undefined)headers['Content-Type']='application/json';
        const controller=new Controller();
        let deadline=null,expired=false;
        const timeoutError=()=>new Error('MIC_REQUEST_TIMEOUT');
        try{
          const timeout=new Promise((_,reject)=>{
            deadline=deadlineLater(()=>{
              expired=true;
              // Reject independently of fetch: injected or broken transports may ignore abort.
              reject(timeoutError());controller.abort();
            },timeoutMs);
          });
          const operation=(async()=>{
            const response=await fetcher('/mic/'+path,{method:body===undefined?'GET':'POST',headers,signal:controller.signal,credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error',...(body===undefined?{}:{body:JSON.stringify(body),keepalive:true})});
            if(expired)throw timeoutError();
            if(!response.ok)throw new Error('MIC_REQUEST_FAILED');
            let result;
            try{result=await response.json();}catch(_){if(expired)throw timeoutError();invalid();}
            if(expired)throw timeoutError();
            return result;
          })();
          return await Promise.race([operation,timeout]);
        }finally{
          if(deadline!==null)deadlineCancel(deadline);
        }
      };
      const config=async()=>{if(!token){const c=await request('config');if(!c||typeof c.token!=='string'||!c.token)invalid();token=c.token;}};
      // Every cleanup route shares the same in-flight request for its private owner.
      // Retire the entry on either outcome so an unconfirmed stop can be retried explicitly.
      const closes=new Map();
      const close=(sid)=>{
        if(closes.has(sid))return closes.get(sid);
        const closing=(async()=>{
          try{
            const s=validate(await request('stop',{session:sid}));
            if(s.active)invalid();
            if(session===sid)session=null;
            return s;
          }finally{closes.delete(sid);}
        })();
        closes.set(sid,closing);
        return closing;
      };
      const poll=async(g)=>{
        timer=null;if(g!==epoch||!session)return;
        try{
          let s=validate(await request('status',undefined,session));
          if(g!==epoch)return;
          // Native may have closed itself, but the HTTP owner session also needs retiring.
          if(s.state==='off'){
            s=await close(session);
            if(g!==epoch)return;
          }
          publish(s.state,s.active,s.state==='error'?'NATIVE_MIC_ERROR':null,s.device);
          if(s.state!=='running'){clear();return;}
          if(s.frames>0&&s.time>lastTime){lastTime=s.time;if(options.onSample)options.onSample(s);}
          if(g===epoch)timer=later(()=>poll(g),50);
        }catch(e){if(g===epoch){clear();fail(e);}}
      };
      this.publicState=()=>structuredClone(view);
      this.scan=async()=>{if(!enabled)return [];try{await config();const r=await request('devices');if(!Array.isArray(r.devices))invalid();return r.devices.filter(device).map(d=>({index:d.index,name:d.name.slice(0,160)}));}catch(e){fail(e);return [];}};
      this.start=async(index)=>{
        if(!enabled)return this.publicState();if(!Number.isInteger(index)||index<0){publish('error',view.active,'EXPLICIT_KINECT_INDEX_REQUIRED');return this.publicState();}
        if(pending||stopping||session||view.active!==false)return this.publicState();
        const g=++epoch;lastTime=0;publish('starting',null);
        pending=(async()=>{try{await config();if(g!==epoch){publish('off',false);return;}const r=await request('start',{index});if(typeof r.session!=='string'||!r.session)invalid();session=r.session;if(g!==epoch){const closed=await close(session);publish(closed.state,false,closed.state==='error'?'NATIVE_MIC_ERROR':null);return;}const s=validate(r);if(!s.active||s.state!=='running')invalid();publish('running',true,null,s.device);timer=later(()=>poll(g),50);}catch(e){fail(e);}finally{pending=null;}})();
        await pending;return this.publicState();
      };
      this.stop=async()=>{
        if(!enabled)return this.publicState();
        if(stopping)return stopping;
        ++epoch;clear();
        stopping=(async()=>{
          if(pending){publish('stopping',null);await pending;}
          if(!session&&view.active===false)return this.publicState();
          publish('stopping',null);
          try{await config();const s=await close(session);publish(s.state,false,s.state==='error'?'NATIVE_MIC_ERROR':null);}
          catch(e){fail(e);}
          return this.publicState();
        })();
        try{return await stopping;}finally{stopping=null;}
      };
    }
  };
});
