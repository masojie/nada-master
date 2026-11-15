// presets/validate.js - validasi struktur dan rentang parameter preset terhadap kontrak engine.
const num=(x)=>typeof x==='number'&&Number.isFinite(x);
const inR=(x,a,b)=>num(x)&&x>=a&&x<=b;
export function validateGenre(g){const e=[],chk=(c,m)=>{if(!c)e.push(m)};
 chk(typeof g.id==='string'&&g.id,'id');chk(typeof g.name==='string'&&g.name,'name');chk(typeof g.category==='string','category');chk(typeof g.description==='string'&&g.description.length>5,'description');
 chk(Array.isArray(g.targetRel)&&g.targetRel.length===10&&g.targetRel.every(num),'targetRel harus 10 angka');chk(g.targetRel&&g.targetRel.every(v=>Math.abs(v)<=20),'targetRel di luar +-20 dB');chk(num(g.tilt)&&Math.abs(g.tilt)<4,'tilt');
 chk(inR(g.lufs,-24,-6),'lufs target -24..-6');const s=g.settings||{};
 chk(s.pre&&inR(s.pre.rumbleHz,10,60),'pre.rumbleHz');
 chk(Array.isArray(s.eq)&&s.eq.length>=1&&s.eq.length<=8,'eq 1..8 band');for(const b of s.eq||[]){chk(['bell','lowshelf','highshelf','hp','lp','notch'].includes(b.type),'eq.type '+b.type);chk(inR(b.f,15,20000),'eq.f');chk(inR(b.g,-12,12),'eq.g');chk(b.q==null||inR(b.q,.1,18),'eq.q')}
 const t=s.tone||{};for(const k of ['lowDb','clarityDb','presenceDb','airDb'])chk(inR(t[k],-6,6),'tone.'+k);for(const k of ['lowHz','clarityHz','presenceHz','airHz'])chk(inR(t[k],20,20000),'tone.'+k);
 const c=s.comp||{};chk(inR(c.thrOffsetDb,-30,0),'comp.thrOffsetDb');chk(inR(c.ratio,1,10),'comp.ratio');chk(inR(c.attackMs,.1,200),'comp.attackMs');chk(inR(c.releaseMs,10,1000),'comp.releaseMs');chk(inR(c.kneeDb,0,18),'comp.kneeDb');chk(inR(c.makeupDb,-6,12),'comp.makeupDb');chk(inR(c.mix,0,100),'comp.mix');
 const m=s.mb||{};chk(Array.isArray(m.xover)&&m.xover.length===3&&m.xover[0]<m.xover[1]&&m.xover[1]<m.xover[2],'mb.xover');chk(Array.isArray(m.bands)&&m.bands.length===4,'mb.bands=4');chk(Array.isArray(m.thrOffsetDb)&&m.thrOffsetDb.length===4,'mb.thrOffsetDb');
 for(const b of m.bands||[]){chk(inR(b.ratio,1,10),'mb.ratio');chk(inR(b.attackMs,.5,200),'mb.attackMs');chk(inR(b.releaseMs,10,1000),'mb.releaseMs');chk(inR(b.gainDb,-12,12),'mb.gainDb')}
 const sa=s.sat||{};chk(['tape','tube','soft','transformer','none'].includes(sa.type),'sat.type');chk(inR(sa.driveDb,0,24),'sat.driveDb');chk(inR(sa.mix,0,100),'sat.mix');
 const st=s.stereo||{};chk(inR(st.width,0,200),'stereo.width');chk(inR(st.widthHz,50,2000),'stereo.widthHz WAJIB (tanpa ini StereoStage menghasilkan NaN)');chk(inR(st.bassMonoHz,0,400),'stereo.bassMonoHz');
 const l=s.limiter||{};chk(inR(l.ceilingDb,-6,0),'limiter.ceilingDb');chk(['transparent','balanced','punchy'].includes(l.style),'limiter.style');chk(inR(l.releaseMs,10,1000),'limiter.releaseMs');chk(inR(l.lookaheadMs,.5,10),'limiter.lookaheadMs');
 const k=s.clip||{};chk(typeof k.on==='boolean','clip.on');if(k.on){chk(['soft','hard'].includes(k.mode),'clip.mode');chk(inR(k.thrDb,-3,3),'clip.thrDb')}
 return e}
export function validateAll(list){const out={};for(const g of list){const e=validateGenre(g);if(e.length)out[g.id||g.name]=e}return out}
