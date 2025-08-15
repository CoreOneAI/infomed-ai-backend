const cors = require("cors");

const allowed = [
  "https://infomed-one.netlify.app",        // your site
  "https://infohealth-ai.netlify.app"       // add any others you own
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);           // curl/postman
    cb(null, allowed.includes(origin));
  },
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));
