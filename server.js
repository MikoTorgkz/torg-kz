const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.send("TEST OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER WORKING");
});