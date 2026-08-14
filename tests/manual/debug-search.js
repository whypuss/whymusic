// 測試 Audiomack 插件搜索
const testCode = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const axios = require("axios");
const cheerio = require("cheerio");
const CryptoJS = require("crypto-js");
const dayjs = require("dayjs");
const pageSize = 20;
const headers = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
};
function nonce(e = 10) {
    let n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", r = "";
    for (let i = 0; i < e; i++)
        r += n.charAt(Math.floor(Math.random() * n.length));
    return r;
}
function getNormalizedParams(parameters) {
    const sortedKeys = [];
    const normalizedParameters = [];
    for (let e in parameters) {
        sortedKeys.push(_encode(e));
    }
    sortedKeys.sort();
    for (let idx = 0; idx < sortedKeys.length; idx++) {
        const e = sortedKeys[idx];
        var n, r, i = _decode(e), a = parameters[i];
        for (a.sort(), n = 0; n < a.length; n++)
            (r = _encode(a[n])), normalizedParameters.push(e + "=" + r);
    }
    return normalizedParameters.join("&");
}
function _encode(e) {
    let r = "";
    for (let n = 0; n < e.length; n++) {
        let a = e.charCodeAt(n), t = "";
        for (; a > 0;) t = a % 64 + t, a = (a - a % 64) / 64;
        r += t || "A";
    }
    return r;
}
function _decode(e) {
    let r = "";
    for (let n = 0; n < e.length; n++) {
        let a = "", t = e[n];
        for (; "A" !== t && t !== ""; ) a += t, t = e[++n];
        let i = 0;
        for (let t = 0; t < a.length; t++) {
            let s = a.charCodeAt(t) - 65;
            i = 64 * i + s;
        }
        r += String.fromCharCode(i);
    }
    return r;
}
function _sort(e) {
    for (let r in e)
        e[r].sort();
    return e;
}
function encrypt(e, r) {
    let n = r || nonce(32);
    return {
        iv: n,
        ciphertext: CryptoJS.AES.encrypt(e, CryptoJS.enc.Utf8.parse(CryptoJS.MD5(CryptoJS.enc.Utf8.parse(CryptoJS.enc.Utf8.parse(n).toString())).toString())).toString(),
    };
}
function decrypt(e, r) {
    return CryptoJS.AES.decrypt(
        { ciphertext: e.ciphertext, iv: e.iv },
        CryptoJS.enc.Utf8.parse(CryptoJS.MD5(CryptoJS.enc.Utf8.parse(CryptoJS.enc.Utf8.parse(r).toString())).toString()),
    ).toString(CryptoJS.enc.Utf8);
}
async function request(e, r = {}) {
    return await axios_1.default.get(e, Object.assign(Object.assign({}, r), { headers: Object.assign(Object.assign({}, headers), r.headers), params: r.params || {} }));
}
async function post(e, r, n = {}) {
    return await axios_1.default.post(e, r, Object.assign(Object.assign({}, n), { headers: Object.assign(Object.assign({}, headers), n.headers) }));
}
async function searchMusic(e) {
    const r = await request("https://api.audiomack.com/v1/search/songs", { params: { q: e, limit: pageSize } });
    const n = r.data.data.songs || [];
    return {
        data: n.map((e) => ({
            id: e.id,
            title: e.title,
            artist: e.artist.name,
            album: e.album?.title,
            artwork: e.cover_url || e.album?.cover_url,
            duration: e.duration,
        })),
        isEnd: n.length < pageSize,
    };
}
async function searchAlbum(e) {
    const r = await request("https://api.audiomack.com/v1/search/albums", { params: { q: e, limit: pageSize } });
    const n = r.data.data.albums || [];
    return {
        data: n.map((e) => ({
            id: e.id,
            title: e.title,
            artist: e.artist.name,
            artwork: e.cover_url,
        })),
        isEnd: n.length < pageSize,
    };
}
async function searchArtist(e) {
    const r = await request("https://api.audiomack.com/v1/search/artists", { params: { q: e, limit: pageSize } });
    const n = r.data.data.artists || [];
    return {
        data: n.map((e) => ({
            id: e.id,
            title: e.name,
            artist: e.name,
            artwork: e.cover_url,
        })),
        isEnd: n.length < pageSize,
    };
}
async function searchSheet(e) {
    return { data: [], isEnd: true };
}
async function getMediaSource(e) {
    const r = await request("https://api.audiomack.com/v1/songs/" + e.id + "/stream", { headers: { "x-auth-token": "dummy" } });
    const n = r.data.data.stream_urls;
    const a = n.standard || n.high || n.low;
    if (!a) throw new Error("無法獲取音源 URL");
    return { url: a };
}
exports.default = {
    platform: "audiomack",
    name: "Audiomack",
    version: "0.0.2",
    description: "Audiomack 音樂搜索",
    author: "maotoumao",
    cacheControl: "no-cache",
    async search(e, r, n = "music") {
        if (n === "music") return await searchMusic(e);
        if (n === "album") return await searchAlbum(e);
        if (n === "artist") return await searchArtist(e);
        if (n === "sheet") return await searchSheet(e);
        return { data: [], isEnd: true };
    },
    getMediaSource,
};
`;

console.log("=== Audiomack 插件代碼 ===");
console.log("search 函數存在:", testCode.includes("async search"));
console.log("返回格式:", testCode.includes("data: n.map"));
console.log("platform:", testCode.includes("platform: \"audiomack\""));