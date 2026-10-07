"use strict";

chrome.runtime.onInstalled.addListener(() => {
  console.log("X Likes Exporter installed. Open https://x.com/<you>/likes and click the toolbar icon.");
});
