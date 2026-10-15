const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const authAttempts = new Map();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: true } : undefined,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000
});
const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, username VARCHAR(18) NOT NULL,
 password_hash TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '⚡',
 role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),
 badges TEXT[] NOT NULL DEFAULT '{}', achievements JSONB NOT NULL DEFAULT '[]'::jsonb, xp BIGINT NOT NULL DEFAULT 0 CHECK(xp>=0),
 games_played INTEGER NOT NULL DEFAULT 0 CHECK(games_played>=0), best_score INTEGER NOT NULL DEFAULT 0 CHECK(best_score>=0),
 best_reaction INTEGER CHECK(best_reaction IS NULL OR best_reaction>0), streak INTEGER NOT NULL DEFAULT 0 CHECK(streak>=0),
 last_played DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS game_scores (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mode TEXT NOT NULL CHECK(mode IN ('trivia','number','reflex')), points INTEGER NOT NULL CHECK(points>=0 AND points<=10000),
 details JSONB NOT NULL DEFAULT '{}'::jsonb, played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS achievements JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS game_scores_leaderboard_idx ON game_scores(points DESC, played_at DESC);
CREATE INDEX IF NOT EXISTS game_scores_user_idx ON game_scores(user_id, played_at DESC);
ALTER TABLE game_scores ADD COLUMN IF NOT EXISTS run_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS game_scores_user_run_key ON game_scores(user_id, run_id) WHERE run_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS badge_requests (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 badge_type TEXT NOT NULL CHECK(badge_type IN ('verified','developer')), message VARCHAR(500) NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS badge_requests_one_pending_idx ON badge_requests(user_id,badge_type) WHERE status='pending';
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGSERIAL PRIMARY KEY, actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL,
 target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
let schemaReady;
function ensureSchema(){ if(!schemaReady) schemaReady=pool.query(schemaSql).catch(e=>{schemaReady=null;throw e}); return schemaReady; }
const today = () => new Date().toISOString().slice(0,10);
const safeUser = u => ({id:u.id,email:u.email,username:u.username,avatar:u.avatar,role:u.role,badges:u.badges||[],achievements:Array.isArray(u.achievements)?u.achievements:[],xp:Number(u.xp||0),games:Number(u.games_played||0),best:Number(u.best_score||0),bestReaction:u.best_reaction?Number(u.best_reaction):0,streak:Number(u.streak||0)});
function send(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));}
function getPath(req){const u=new URL(req.url,'https://nexplay.invalid');return ('/'+(u.searchParams.get('path')||u.pathname.replace(/^\/api\/?/,''))).replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/'}
async function body(req){if(req.body&&typeof req.body==='object')return req.body;let raw='';for await(const chunk of req) {raw+=chunk;if(raw.length>20000)throw Object.assign(new Error('Request body too large'),{status:413})}try{return raw?JSON.parse(raw):{}}catch{throw Object.assign(new Error('Send valid JSON.'),{status:400})}}
function tokenFor(u){return jwt.sign({sub:String(u.id)},process.env.JWT_SECRET,{expiresIn:'7d',issuer:'nexplay-api',audience:'nexplay-player'})}
async function auth(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw Object.assign(new Error('Sign in to continue.'),{status:401});let claims;try{claims=jwt.verify(h.slice(7),process.env.JWT_SECRET,{issuer:'nexplay-api',audience:'nexplay-player'})}catch{throw Object.assign(new Error('Your session expired. Please sign in again.'),{status:401})}const q=await pool.query('SELECT * FROM users WHERE id=$1',[claims.sub]);if(!q.rowCount)throw Object.assign(new Error('Account not found.'),{status:401});return q.rows[0]}
async function admin(req){const u=await auth(req);if(u.role!=='admin')throw Object.assign(new Error('Admin access is required.'),{status:403});return u}
async function log(actor,action,target,metadata={}){await pool.query('INSERT INTO audit_logs(actor_id,action,target_user_id,metadata) VALUES($1,$2,$3,$4)',[actor,action,target,JSON.stringify(metadata)])}
module.exports = async function handler(req,res){
 const origin=req.headers.origin;
 const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(origin&&allowed.length&&!allowed.includes(origin)){return send(res,403,{error:'Origin not allowed.'})}
 if(origin&&allowed.length)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
 if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
 const path=getPath(req), method=req.method;
 if(method==='POST'&&(path==='/login'||path==='/register')){const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();const key=ip+'|'+path;const now=Date.now();const bucket=authAttempts.get(key);if(!bucket||now-bucket.start>15*60*1000){authAttempts.set(key,{start:now,count:1})}else if(bucket.count>=10){return send(res,429,{error:'Too many attempts. Please wait 15 minutes and try again.'})}else{bucket.count++}}
 if(!process.env.DATABASE_URL||!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32){return send(res,503,{error:'API setup is incomplete. Configure DATABASE_URL and a JWT_SECRET of at least 32 characters.'})}
 try{
  await ensureSchema();
  const path=getPath(req), method=req.method;
  if(path==='/health'&&method==='GET'){await pool.query('SELECT 1');return send(res,200,{ok:true,service:'NEXPLAY API',time:new Date().toISOString()})}
  const data=['POST','PATCH'].includes(method)?await body(req):{};
  if(path==='/register'&&method==='POST'){
   const email=String(data.email||'').trim().toLowerCase(), username=String(data.username||'').trim(), password=String(data.password||'');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return send(res,400,{error:'Enter a valid email address.'});
   if(username.length<2||username.length>18||/[<>]/.test(username))return send(res,400,{error:'Player name must be 2–18 characters.'});
   if(password.length<10||password.length>128)return send(res,400,{error:'Use a password between 10 and 128 characters.'});
   const isAdminEmail=(process.env.ADMIN_EMAIL||'').trim().toLowerCase()===email;
   if(isAdminEmail){const expected=String(process.env.ADMIN_SETUP_TOKEN||''),provided=String(data.adminSetupToken||'');const a=Buffer.from(provided),b=Buffer.from(expected);if(expected.length<24||a.length!==b.length||!crypto.timingSafeEqual(a,b))return send(res,403,{error:'The site-owner setup code is required for this email.'})}
   const hash=await bcrypt.hash(password,12), role=isAdminEmail?'admin':'player';
   const q=await pool.query('INSERT INTO users(email,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *',[email,username,hash,role]);
   await log(q.rows[0].id,'account.registered',q.rows[0].id,{role});
   return send(res,201,{token:tokenFor(q.rows[0]),user:safeUser(q.rows[0])});
  }
  if(path==='/login'&&method==='POST'){
   const email=String(data.email||'').trim().toLowerCase(),password=String(data.password||'');
   const q=await pool.query('SELECT * FROM users WHERE email=$1',[email]);
   if(!q.rowCount||!(await bcrypt.compare(password,q.rows[0].password_hash)))return send(res,401,{error:'Email or password is incorrect.'});
   return send(res,200,{token:tokenFor(q.rows[0]),user:safeUser(q.rows[0])});
  }
  if(path==='/me'&&method==='GET'){const u=await auth(req);return send(res,200,{user:safeUser(u)})}
  if(path==='/profile'&&method==='PATCH'){
   const u=await auth(req),username=String(data.username||'').trim(),avatar=String(data.avatar||'⚡');
   if(username.length<2||username.length>18||/[<>]/.test(username))return send(res,400,{error:'Player name must be 2–18 characters.'});
   if(!['⚡','🦊','🐺','🦁','🚀','👾','🧠'].includes(avatar))return send(res,400,{error:'Choose one of the available avatars.'});
   const q=await pool.query('UPDATE users SET username=$1,avatar=$2,updated_at=NOW() WHERE id=$3 RETURNING *',[username,avatar,u.id]);
   return send(res,200,{user:safeUser(q.rows[0])});
  }
  if(path==='/scores'&&method==='POST'){
   const u=await auth(req),mode=String(data.mode||''),points=Number(data.points),details=data.details&&typeof data.details==='object'?data.details:{};
   const runId=data.runId===undefined||data.runId===null?null:String(data.runId);
   if(runId!==null&&!/^[A-Za-z0-9-]{8,64}$/.test(runId))return send(res,400,{error:'Invalid run id.'});
   const maxPoints={trivia:106,number:1500,reflex:600}[mode];if(!maxPoints||!Number.isInteger(points)||points<0||points>maxPoints)return send(res,400,{error:'Invalid game score for this mode.'});
   const allowedDetails={};for(const k of ['correct','solved','avg','best']){const v=Number(details[k]);if(Number.isFinite(v)&&v>=0&&v<=100000)allowedDetails[k]=v}const allowedAchievementIds=['first-run','brainiac','xp-100','speed-demon','streak-3'];const achievements=[...new Set([...(Array.isArray(u.achievements)?u.achievements:[]),...(Array.isArray(data.achievements)?data.achievements.filter(x=>allowedAchievementIds.includes(x)):[])])];
   const todayDate=today();
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    // A repeated runId (double submit, retry after a dropped response, or an offline re-send) is recorded once and awards no extra XP.
    const q=await client.query('INSERT INTO game_scores(user_id,mode,points,details,run_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id,run_id) WHERE run_id IS NOT NULL DO NOTHING RETURNING id,played_at',[u.id,mode,points,JSON.stringify(allowedDetails),runId]);
    if(!q.rowCount){await client.query('ROLLBACK');const current=await pool.query('SELECT * FROM users WHERE id=$1',[u.id]);return send(res,200,{duplicate:true,user:safeUser(current.rows[0])})}
    const uq=await client.query(`UPDATE users SET xp=xp+$1,games_played=games_played+1,best_score=GREATEST(best_score,$1),
    best_reaction=CASE WHEN $2::int>0 THEN LEAST(COALESCE(best_reaction,$2::int),$2::int) ELSE best_reaction END,
    streak=CASE WHEN last_played=$3::date THEN streak WHEN last_played=$3::date-1 THEN streak+1 ELSE 1 END,
    last_played=$3::date,achievements=$5::jsonb,updated_at=NOW() WHERE id=$4 RETURNING *`,
    [points,mode==='reflex'&&allowedDetails.best?allowedDetails.best:0,todayDate,u.id,JSON.stringify(achievements)]);
    await client.query('COMMIT');
    return send(res,201,{score:q.rows[0],user:safeUser(uq.rows[0])});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  }
  if(path==='/leaderboard'&&method==='GET'){
   const q=await pool.query(`SELECT id,username,avatar,badges,xp,games_played,best_score FROM users ORDER BY xp DESC, best_score DESC, created_at ASC LIMIT 50`);
   return send(res,200,{players:q.rows.map(u=>({id:u.id,name:u.username,avatar:u.avatar,badges:u.badges||[],xp:Number(u.xp),games:Number(u.games_played),best:Number(u.best_score)}))});
  }
  if(path==='/badges/request'&&method==='POST'){
   const u=await auth(req),type=String(data.type||''),message=String(data.message||'').trim().slice(0,500);
   if(!['verified','developer'].includes(type))return send(res,400,{error:'Unknown badge type.'});
   if((u.badges||[]).includes(type))return send(res,409,{error:'You already have this badge.'});
   try{const q=await pool.query('INSERT INTO badge_requests(user_id,badge_type,message) VALUES($1,$2,$3) RETURNING id,status,created_at',[u.id,type,message]);await log(u.id,'badge.requested',u.id,{type});return send(res,201,{request:q.rows[0]})}
   catch(e){if(e.code==='23505')return send(res,409,{error:'You already have a pending request for this badge.'});throw e}
  }
  if(path==='/badges/mine'&&method==='GET'){const u=await auth(req);const q=await pool.query('SELECT id,badge_type,status,message,created_at,reviewed_at FROM badge_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[u.id]);return send(res,200,{requests:q.rows})}
  if(path==='/admin/overview'&&method==='GET'){
   await admin(req);
   const [users,scores,badges,requests]=await Promise.all([
    pool.query('SELECT COUNT(*)::int count FROM users'),pool.query('SELECT COUNT(*)::int count FROM game_scores'),
    pool.query("SELECT COUNT(*)::int count FROM users WHERE cardinality(badges)>0"),
    pool.query("SELECT COUNT(*)::int count FROM badge_requests WHERE status='pending'")]);
   return send(res,200,{users:users.rows[0].count,scores:scores.rows[0].count,badgedUsers:badges.rows[0].count,pendingRequests:requests.rows[0].count});
  }
  if(path==='/admin/badges'&&method==='GET'){
   await admin(req);const q=await pool.query(`SELECT r.id,r.badge_type,r.message,r.status,r.created_at,u.id user_id,u.username,u.email
    FROM badge_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.created_at ASC LIMIT 100`);
   return send(res,200,{requests:q.rows});
  }
  const match=path.match(/^\/admin\/badges\/(\d+)$/);
  if(match&&method==='PATCH'){
   const a=await admin(req),decision=String(data.decision||'');
   if(!['approved','rejected'].includes(decision))return send(res,400,{error:'Choose approve or reject.'});
   const client=await pool.connect();try{await client.query('BEGIN');const rq=await client.query('SELECT * FROM badge_requests WHERE id=$1 FOR UPDATE',[match[1]]);if(!rq.rowCount)throw Object.assign(new Error('Badge request not found.'),{status:404});const r=rq.rows[0];if(r.status!=='pending')throw Object.assign(new Error('This request was already reviewed.'),{status:409});await client.query('UPDATE badge_requests SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3',[decision,a.id,r.id]);if(decision==='approved')await client.query('UPDATE users SET badges=ARRAY(SELECT DISTINCT unnest(badges||$1::text[])),updated_at=NOW() WHERE id=$2',[[r.badge_type],r.user_id]);await client.query('INSERT INTO audit_logs(actor_id,action,target_user_id,metadata) VALUES($1,$2,$3,$4)',[a.id,'badge.'+decision,r.user_id,JSON.stringify({requestId:r.id,type:r.badge_type})]);await client.query('COMMIT');return send(res,200,{ok:true,status:decision})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }
  if(path==='/admin/users'&&method==='GET'){
   await admin(req);const q=await pool.query('SELECT id,email,username,role,badges,xp,games_played,created_at FROM users ORDER BY created_at DESC LIMIT 100');return send(res,200,{users:q.rows.map(u=>({...u,xp:Number(u.xp),games:Number(u.games_played)}))});
  }
  if(path==='/admin/users/badges'&&method==='PATCH'){
   const a=await admin(req),id=Number(data.userId),type=String(data.type||''),action=String(data.action||'');
   if(!Number.isInteger(id)||id<1||!['verified','developer'].includes(type)||!['grant','revoke'].includes(action))return send(res,400,{error:'Invalid badge action.'});
   const badges=action==='grant'?'array_append(badges,$1)':'array_remove(badges,$1)';
   const q=await pool.query(`UPDATE users SET badges=(SELECT ARRAY(SELECT DISTINCT unnest(${badges}))),updated_at=NOW() WHERE id=$2 RETURNING id,badges`,[type,id]);
   if(!q.rowCount)return send(res,404,{error:'Player not found.'});await log(a.id,'badge.'+action,id,{type});return send(res,200,{user:q.rows[0]});
  }
  if(path==='/admin/audit'&&method==='GET'){
   await admin(req);const q=await pool.query('SELECT a.id,a.action,a.metadata,a.created_at,u.username actor,t.username target FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_user_id ORDER BY a.created_at DESC LIMIT 100');return send(res,200,{events:q.rows});
  }
  return send(res,404,{error:'API route not found.'});
 }catch(e){console.error('NEXPLAY API error:',e.message);const status=e.status||(e.code==='23505'?409:500);const message=e.status?e.message:e.code==='23505'?'An account with this email already exists.':'Something went wrong. Please try again.';return send(res,status,{error:message})}
};
