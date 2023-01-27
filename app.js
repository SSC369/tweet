const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

const bcrypt = require("bcrypt");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//register

app.post("/register/", async (request, response) => {
  const { username, name, password, gender, location } = request.body;

  const hashedPassword = await bcrypt.hash(request.body.password, 10);

  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;

  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    if (password.length > 6) {
      const createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        )`;
      const dbResponse = await db.run(createUserQuery);
      const newUserId = dbResponse.lastID;
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//login
let jwt = require("jsonwebtoken");
app.post("/login", async (request, response) => {
  const { username, password } = request.body;

  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;

  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "SSC");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});
//
app.get("/users", async (request, response) => {
  let query = `
    SELECT * FROM user ORDER BY username;`;
  let dbResponse = await db.all(query);
  response.send(dbResponse);
});
//

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SSC", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};
//

app.get("/followers", async (request, response) => {
  let query = `
    SELECT * FROM follower ORDER BY follower_id;`;
  let dbResponse = await db.all(query);
  response.send(dbResponse);
});

app.get("/users", async (request, response) => {
  let query = `SELECT * FROM user ORDER BY user_id;`;
  let dbResponse = await db.all(query);
  response.send(dbResponse);
});

app.get("/tweets", async (request, response) => {
  let query = `SELECT * FROM tweet ORDER BY tweet_id;`;
  let dbResponse = await db.all(query);
  response.send(dbResponse);
});

//api 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let query = `SELECT username, tweet, date_time AS dateTime FROM (tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id) AS k
  INNER JOIN user ON k.following_user_id = user.user_id 
  WHERE follower_user_id = (SELECT user_id FROM user WHERE username like '%${request.username}%') order by date_time limit 4;`;
  let dbResponse = await db.all(query);
  response.send(dbResponse);
});

//api 4
app.get("/user/following", authenticateToken, async (request, response) => {
  let query = `select name from user inner join follower on 
    user.user_id = follower.following_user_id WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;

  let dbResponse = await db.all(query);
  response.send(dbResponse);
});

//api5

app.get("/user/followers", authenticateToken, async (request, response) => {
  let query = `select name from user inner join follower on 
    user.user_id = follower.follower_user_id WHERE following_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;

  let dbResponse = await db.all(query);
  response.send(dbResponse);
});

//api6
let followCheck = async (request, response, next) => {
  let tweetList = [];
  let { tweetId } = request.params;
  let query = `select tweet_id from tweet inner join follower
    on tweet.user_id = follower.following_user_id where
    follower_user_id = (select user_id from user where username = '${request.username}');`;

  let dbResponse = await db.all(query);
  let i;
  for (i = 0; i < dbResponse.length; i++) {
    tweetList.push(dbResponse[i].tweet_id);
  }
  if (tweetList.includes(Number(tweetId))) {
    next();
  } else {
    response.status(401);
    response.send(`Invalid Request`);
  }
};

/////
app.get(
  "/tweets/:tweetId",
  authenticateToken,
  followCheck,
  async (request, response) => {
    let { tweetId } = request.params;

    let query = `select tweet, count(like_id) as likes, (select count(reply_id) from reply where tweet_id = ${tweetId}) as replies
    ,date_time as dateTime from tweet inner join like on tweet.tweet_id = like.tweet_id where like.tweet_id = ${tweetId};`;

    let dbResponse = await db.get(query);
    response.send(dbResponse);
  }
);
//

app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  followCheck,
  async (request, response) => {
    let { tweetId } = request.params;
    let query = `select * from like inner join user on 
    user.user_id = like.user_id where like.tweet_id = ${tweetId};`;
    let dbResponse = await db.all(query);
    let likesList = [];
    for (let i = 0; i < dbResponse.length; i++) {
      likesList.push(dbResponse[i].username);
    }
    response.send({ likes: likesList });
  }
);

let selfCheck = async (request, response, next) => {
  let { tweetId } = request.params;
  let tweetList = [];

  let query = `select user_id from user where username like '%${request.username}%';`;
  let userId = await db.get(query);

  let query2 = `select tweet_id from tweet where user_id = ${userId.user_id};`;
  let dbResponse = await db.all(query2);
  let i;
  for (i = 0; i < dbResponse.length; i++) {
    tweetList.push(dbResponse[i].tweet_id);
  }
  if (tweetList.includes(Number(tweetId))) {
    console.log(tweetList);
    next();
  } else {
    console.log(tweetList);
    response.status(401);
    response.send(`Invalid Request`);
  }
};
//delete tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  selfCheck,
  async (request, response) => {
    let { tweetId } = request.params;
    let query = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
    let dbResponse = await db.run(query);
    response.send(`Tweet Removed`);
  }
);

//
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  let details = request.body;
  let { tweet } = details;

  let query1 = `select user_id from user where username like '%${request.username}%';`;
  let dbR = await db.get(query1);
  let userId = dbR.user_id;
  let query2 = `INSERT INTO tweet(tweet, user_id)
    VALUES(
        '${tweet}',
        ${userId}
    );`;

  let dbResponse = await db.run(query2);
  response.send("Created a Tweet");
});
//

app.get("/user/tweets", authenticateToken, async (request, response) => {
  let query = `select user_id from user where username like '%${request.username}%';`;
  let dbResponse = await db.get(query);
  let userId = dbResponse.user_id;

  let query2 = `select tweet_id from tweet where user_id = ${Number(userId)};`;
  let dbResponse2 = await db.all(query2);
  let result = [];
  let i;
  for (i = 0; i < dbResponse2.length; i++) {
    let tweetId = dbResponse2[i].tweet_id;
    let query3 = `select tweet, count(like_id) as likes, (select count(reply_id) from reply where tweet_id = ${tweetId}) as replies
    ,date_time as dateTime from tweet inner join like on tweet.tweet_id = like.tweet_id where like.tweet_id = ${tweetId};`;
    let dbR = await db.get(query3);
    result.push(dbR);
  }
  response.send(result);
});

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  followCheck,
  async (request, response) => {
    let { tweetId } = request.params;

    let query = `select name, reply from reply inner join user on
    user.user_id = reply.user_id where tweet_id = ${tweetId};`;
    let dbResponse = await db.all(query);

    response.send({ replies: dbResponse });
  }
);
module.exports = app;