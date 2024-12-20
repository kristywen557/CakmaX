const express = require('express');
const app = express();
const path = require('path');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const { QuickDB } = require("quick.db");
const db = new QuickDB();
const bodyParser = require('body-parser');
//
let redirectURL = "https://discord.com/oauth2/authorize?client_id=...&response_type=code&redirect_uri=https%3A%2F%2Fx.kristywen.com.tr/callback&scope=identify"
//DISCORD
const DiscordOauthClient = require('discord-auth.js');
const discordOauthClient = new DiscordOauthClient("id", "secret key", "https://x.kristywen.com.tr/callback");
//DB
var accountTable = db.table('accounts');
var postTable = db.table('posts');
//ENGINE
const api = express.Router();
let ejsOptions = {
    async: true
};
app.engine('ejs', async (path, data, cb) => {
    try{
      let html = await ejs.renderFile(path, data, ejsOptions);
      cb(null, html);
    }catch (e){
      cb(e, '');
    }
});
//MIDDLEWARES
function checkAccount() {
  return async (req, res, next) => {
      const account = req.account;
      if (Object.keys(account).length == 0) {
          return res.redirect('/login');
      }
      next();
  };
}
function getAccount() {
  return async (req, res, next) => {
      const token = req?.cookies?.token;
      const account = (await accountTable.all()).find((account) => token == account.value.token)?.value || {};
      res.locals.account = account || {};
      req.account = account || {};
      next();
  };
}
function validateBody(args) {
  return (req, res, next) => {
      for (const arg of args) {
          if (!req.body?.hasOwnProperty(arg) || req.body[arg] === '' || req.body[arg] == '&nbsp;') {
              return res.redirect('/?toastr=Invalid Body!');
          }
      }
      next();
  };
}
function validatePost() {
  return async (req, res, next) => {
    const post = await postTable.get(req?.params?.post);
    if(post == null) return res.redirect("/?toastr=The Post hasn't found!"); 
    req.post = post;
    next();
  };
}
function validateSelectedAccount() {
  return async (req, res, next) => {
    const account = await accountTable.get(req?.params?.account);
    if(account == null) return res.redirect("/?toastr=The Account hasn't found!"); 
    req.selectedAccount = account;
    next();
  };
}
//SET
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
//USE
app.use(express.static('static'))
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(getAccount());
app.use('/api',api)

//PAGES
app.get('/', async function(req, res) {
  let data = { page: "home", db: await db, account: req.account, navbar: [{ title: "Latest Posts", page: "/" }, { title: "My Posts", page: "/profile/" + (req.account?.id || 0) }, { title: "Announces", page: "/?filter=announces" }] }
  res.render('index',data);
});

app.get('/post', checkAccount(), async function(req, res) {
  let data = {page:"post",db:await db,navbar:[{title:"General",page:"/post?type=general"},{title:"Announce",page:"/post?type=announce"}]}
  res.render('index',data);
});

app.get('/inbox', checkAccount(), async function(req, res) {
  let data = {page:"inbox",db:await db,past:req?.query?.past==''?true:false,navbar:[{title:"Unreaded",page:"/inbox"},{title:"Past",page:"/inbox?past"}]}
  res.render('index',data);
});

app.get('/reply/:post', checkAccount(), validatePost(), async function(req, res) {
  let data = { page: "reply", db, post: req.post, navbar: [{ title: "Spesific", page: "/reply/" + req.params?.post }] }
  res.render('index',data);
});

app.get('/replies/:post', checkAccount(), validatePost(), async function(req, res) {
  let data = { page: "replies", db, post: req.post, navbar: [{ title: "Replies", page: "/replies/" + req.params?.post }] }
  res.render('index',data);
});

app.get('/profile/:account', checkAccount(), validateSelectedAccount(), async function(req, res) {
  let data = {page:"profile",db,showReplies:req?.query?.replies==''?true:false,selectedAccount:req.selectedAccount,navbar:[{title:"Posts",page:"/profile/"+req.params?.account},{title:"Replies",page:"/profile/"+req.params?.account+"?replies"}]}
  res.render('index',data);
});

//OAUTH2
app.get('/callback', async (req, res) => {
  if(req.query.code){
    let user = await discordOauthClient.getUser(req.query.code)
    if(user?.message == "401: Unauthorized") {
      return res.sendStatus(401);
    }
    let token = Math.random().toString(36).slice(2, 15).toUpperCase();
    await accountTable.set(user.id,{id:user.id,username:user.global_name,avatar:user.avatar,token,inbox:{}})
    res.cookie('token', token, {
      expires: new Date(Date.now() + 999 * 999 * 999 * 999)
    });
    return res.redirect("/")
  } else {
      res.redirect("/?toastr=Couldn't connect to your Discord Account!");
  }
});
app.get('/login',(req,res) => {
  //res.redirect('https://discord.com/oauth2/authorize?client_id=1260265796983324744&response_type=code&redirect_uri=https%3A%2F%2Fx.kristywen.com.tr&scope=identify')
  res.redirect(redirectURL)
})
app.get('/logout',(req,res) => {
  res.clearCookie('token');
  res.redirect('/')
})

//API
api.post('/post',checkAccount(), validateBody(['content']), async (req,res) => {
  let postId = Math.random().toString().slice(2, 12);
  postTable.set(postId,{id:postId,author:req.account?.id,content:req.body?.content,view:0,replies:[],type:0})
  res.redirect("/?toastr=Your post has been sent successfully.")
})

api.get('/delete/:post',checkAccount(), validatePost(), async (req,res) => {
  if(req.post?.author != req.account?.id) return res.redirect(403,"/")
  if(await postTable.get(req?.post?.context || "") != null) await postTable.pull(req?.post?.context+".replies",req?.post?.id)
  postTable.delete(req?.post?.id)
  let back = req.header('Referer') || '/';
  if(back.includes(req.post?.id)) back = '/'
  res.redirect(back+"?toastr=Your post has been successfully deleted.")
})

api.post('/reply/:post',checkAccount(), validateBody(['content']), validatePost(), async (req,res) => {
  let replyPostId = Math.random().toString().slice(2, 12);
  let inboxItemId = Math.random().toString().slice(2, 12);
  await postTable.set(replyPostId,{id:replyPostId,author:req.account?.id,content:req.body?.content,replies:[],view:0,type:1,context:req?.post?.id})
  await postTable.push(req?.post?.id+".replies",replyPostId)
  if(req?.account.id != req?.post.author) await accountTable.set(req?.post?.author+".inbox."+inboxItemId,{past:false,user:req.account?.id,content:"A user replied to your post.",context:"/replies/"+req?.post?.id+"#"+replyPostId})
  res.redirect('/replies/'+req.post?.id+"?toastr=Your reply has been sent successfully.")
})
app.get('/ext/products', async (req, res) => {
    const ip = req.connection.remoteAddress
    res.send(ip)
})
//RUN
app.listen(5454);
