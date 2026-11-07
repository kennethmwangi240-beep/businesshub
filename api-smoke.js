const B=process.env.BASE_URL||'http://localhost:3847';let pass=0,fail=0;
const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':'  -> '+JSON.stringify(x)))};
async function f(m,p,body,tok,hdr={}){const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{}),...hdr},body:body?JSON.stringify(body):undefined});let j={};try{j=await r.json()}catch{};return{s:r.status,j}}
(async()=>{
let r=await f('POST','/api/login',{email:(process.env.ADMIN_EMAIL||'admin@test.com'),password:(process.env.ADMIN_PASSWORD||'Adminpass123'),adminOnly:true});ok('admin login',r.s===200&&r.j.isAdmin,r);const A=r.j.token;
r=await f('POST','/api/login',{email:(process.env.ADMIN_EMAIL||'admin@test.com'),password:'bad'});ok('bad login 401',r.s===401);
r=await f('POST','/api/admin/register',{});ok('admin signup disabled',r.s===403);
r=await f('POST','/api/register',{email:'bad',password:'x'});ok('register validation',r.s===400);
r=await f('POST','/api/register',{email:'Own1@test.com',password:'password1',name:'Own One',phone:'0700'});ok('register',r.s===201,r);const T=r.j.token,U=r.j.user.id;
r=await f('POST','/api/register',{email:'own1@test.com',password:'password1'});ok('dup email 409',r.s===409);
r=await f('POST','/api/login',{email:'own1@test.com',password:'password1',adminOnly:true});ok('owner adminOnly 403',r.s===403);
r=await f('GET','/api/me',null,T);ok('me',r.s===200&&r.j.plans.PRO&&!r.j.isAdmin,r);
r=await f('GET','/api/me');ok('me unauth 401',r.s===401);
r=await f('POST','/api/businesses',{name:'Shop A',categories:['electrical'],plan:'ENTERPRISE',color:'#111'},T);ok('create biz',r.s===201&&r.j.business.plan==='FREE'&&r.j.business.name==='Shop A',r);const BID=r.j.business.id;
r=await f('POST','/api/businesses',{name:'Shop B'},T);ok('FREE biz limit 403',r.s===403,r);
r=await f('POST','/api/businesses',{name:'x'},A);ok('admin cannot create',r.s===403);
const prods=[{id:'p1',name:'Cable',price:100,stock:10,cost:50,active:true},{id:'p2',name:'Bulb',price:50,stock:5,active:true}];
r=await f('PUT','/api/businesses/'+BID,{products:prods,plan:'BUSINESS',suspended:true,workers:[{id:'w1'},{id:'w2'}]},T);
ok('owner save; plan locked',r.s===200&&r.j.business.plan==='FREE'&&!r.j.business.suspended&&r.j.business.products.length===2,r.j);
ok('worker limit FREE=1',r.j.business.workers.length===1,r.j.business.workers);
r=await f('GET','/api/public/shops');ok('public shops list',r.s===200&&r.j.shops.length===1&&r.j.shops[0].productCount===2,r);
r=await f('GET','/api/public/shops/'+BID);ok('public shop no cost leak',r.s===200&&r.j.shop.products.length===2&&r.j.shop.products[0].cost===undefined,r.j);
r=await f('POST','/api/public/shops/'+BID+'/orders',{items:[{product_id:'p1',qty:3,price:1}],customerName:'C',phone:'07'});ok('online order uses server price',r.s===201&&r.j.order.total===300&&r.j.order.status==='PENDING',r);
r=await f('POST','/api/public/shops/'+BID+'/orders',{items:[{product_id:'p2',qty:99}]});ok('oos 409',r.s===409);
r=await f('POST','/api/public/shops/'+BID+'/orders',{items:[{product_id:'zz',qty:1}]});ok('bad item 400',r.s===400);
r=await f('GET','/api/businesses/'+BID,null,T);ok('stock deducted & order stored',r.j.business.products[0].stock===7&&r.j.business.orders.length===1,r.j.business.products);
// stale save keeps online order
r=await f('PUT','/api/businesses/'+BID,{products:prods,orders:[]},T);ok('stale save keeps order + subtracts stock',r.j.business.orders.length===1&&r.j.business.products[0].stock===7,{o:r.j.business.orders.length,s:r.j.business.products[0].stock});
// cross-tenant
r=await f('POST','/api/register',{email:'own2@test.com',password:'password2'});const T2=r.j.token;
r=await f('GET','/api/businesses/'+BID,null,T2);ok('other owner forbidden',r.s===403);
r=await f('GET','/api/businesses',null,T2);ok('other owner list empty',r.j.businesses.length===0);
r=await f('DELETE','/api/businesses/'+BID,null,T2);ok('other owner cannot delete',r.s===403);
r=await f('GET','/api/admin/overview',null,T);ok('owner no admin overview',r.s===403);
// plan request
r=await f('POST','/api/businesses/'+BID+'/plan-request',{plan:'PRO',receipt:'QWE123',phone:'0700'},T);ok('plan request',r.s===200&&r.j.pendingPlan,r);
r=await f('POST','/api/businesses/'+BID+'/plan-request',{plan:'FREE'},T);ok('plan request FREE rejected',r.s===400);
r=await f('GET','/api/admin/alerts',null,A);ok('admin alert created',r.j.alerts.some(a=>a.type==='plan_payment'));
r=await f('PUT','/api/businesses/'+BID,{plan:'PRO'},A);ok('admin sets plan',r.s===200&&r.j.business.plan==='PRO'&&r.j.business.planReceipt==='QWE123'&&!r.j.business.pendingPlan,r.j);
r=await f('PUT','/api/businesses/'+BID,{workers:[{id:'w1'},{id:'w2'},{id:'w3'}]},T);ok('PRO workers ok',r.j.business.workers.length>=3,r.j.business.workers);
r=await f('POST','/api/businesses',{name:'Shop B'},T);ok('PRO allows 2nd biz',r.s===201,r);
// admin
r=await f('GET','/api/admin/overview',null,A);ok('admin overview',r.s===200&&r.j.totals.clients===2&&r.j.totals.businesses===2,r.j.totals);
r=await f('GET','/api/admin/platform-stats',null,A);ok('platform stats MRR',r.s===200&&r.j.totals.mrr===1500,r.j.totals);
r=await f('PUT','/api/admin/plans',{plans:{PRO:{price:1600}}},A);ok('edit plans',r.s===200&&r.j.plans.PRO.price===1600,r.j.plans?.PRO);
r=await f('PUT','/api/admin/platform',{company:'MBH',mpesaTill:'123'},A);ok('edit platform',r.j.platform.company==='MBH');
r=await f('POST','/api/admin/notices',{title:'Hi',body:'Update'},A);ok('publish notice',r.s===201);const NID=r.j.notice.id;
r=await f('GET','/api/notices',null,T);ok('client sees notice',r.j.notices.length===1&&r.j.platformUpdate?.title==='Hi');
r=await f('DELETE','/api/admin/notices',{id:NID},A);ok('delete notice',r.s===200);
// support
r=await f('POST','/api/support/tickets',{subject:'Help',body:'pls',businessId:BID},T);ok('ticket create',r.s===201);const TID=r.j.ticket.id;
r=await f('GET','/api/support/tickets',null,T2);ok('ticket isolation',r.j.tickets.length===0);
r=await f('POST','/api/support/tickets/reply',{ticketId:TID,body:'done',status:'resolved'},A);ok('admin reply',r.s===200&&r.j.ticket.status==='resolved');
r=await f('GET','/api/support/tickets',null,A);ok('admin sees tickets',r.j.tickets.length===1);
// pin lock
r=await f('POST','/api/admin/pin-lock',{businessId:BID,fails:3},T);ok('pin lock',r.s===200&&r.j.business.pinLocked);
r=await f('POST','/api/admin/pin-unlock',{businessId:BID,newPin:'1234'},T);ok('owner cannot unlock',r.s===403);
r=await f('POST','/api/admin/pin-unlock',{businessId:BID,newPin:'1234'},A);ok('admin unlock',r.s===200&&!r.j.business.pinLocked&&r.j.business.salesPin==='1234');
// backup
r=await f('POST','/api/businesses/'+BID+'/backup',{},T);ok('business backup',r.s===200&&r.j.file,r);
r=await f('GET','/api/backups/mine',null,T);ok('list backups',r.j.files.length>=1,r);
r=await f('GET','/api/admin/backup',null,A);ok('admin backup',r.s===200&&r.j.data.users.length===3&&r.j.data.businesses.length===2,r.j.data&&r.j.data.users.length);
r=await f('GET','/api/admin/audit',null,A);ok('audit endpoint',r.s===200);
// forgot/reset
r=await f('POST','/api/auth/forgot',{email:'own1@test.com'});ok('forgot generic no code leak',r.s===200&&!JSON.stringify(r.j).match(/\d{6}/));
r=await f('GET','/api/admin/alerts',null,A);const al=r.j.alerts.find(a=>a.type==='password_reset_request');const code=al&&al.message.match(/code: (\d{6})/)[1];ok('admin gets code',!!code);
r=await f('POST','/api/auth/reset',{email:'own1@test.com',code:'000000',password:'newpassword1'});ok('bad code',r.s===400);
r=await f('POST','/api/auth/reset',{email:'own1@test.com',code,password:'newpassword1'});ok('reset',r.s===200,r);
r=await f('GET','/api/me',null,T);ok('sessions revoked after reset',r.s===401);
r=await f('POST','/api/login',{email:'own1@test.com',password:'newpassword1'});ok('login new pw',r.s===200);const T1b=r.j.token;
r=await f('POST','/api/admin/users/reset-password',{userId:U,password:'adminset123'},A);ok('admin reset pw',r.s===200);
r=await f('POST','/api/logout',null,T1b);ok('logout',r.s===200);r=await f('GET','/api/me',null,T1b);ok('logout kills session',r.s===401);
// misc
r=await f('GET','/api/nope');ok('unknown api 404',r.s===404);
let x=await fetch(B+'/nope.js');ok('unknown asset 404',x.status===404);x=await fetch(B+'/some/route');ok('SPA fallback',x.status===200);
x=await fetch(B+'/..%2f..%2fetc/passwd');ok('traversal blocked',x.status!==200||!(await x.text()).includes('root:'));
x=await fetch(B+'/%2e%2e/server.js');ok('traversal server.js blocked',!(await x.text()).includes('createServer'));
r=await f('DELETE','/api/admin/users',{userId:U},A);ok('admin delete user cascade',r.s===200);
r=await f('GET','/api/admin/overview',null,A);ok('after delete',r.j.totals.clients===1&&r.j.totals.businesses===0,r.j.totals);
// rate limit on login
let last;for(let i=0;i<9;i++)last=await f('POST','/api/login',{email:'zz@test.com',password:'wrongwrong'});ok('login lockout',last.s===429,last);
console.log(`\n${pass} passed, ${fail} failed`);})();
