const port = Number(process.env.PORT) || 8080;
if (!app.locals._listening) {
  app.locals._listening = true;               // prevents double-listen during dev reloads
  app.listen(port, () => console.log("listening on", port));
}
