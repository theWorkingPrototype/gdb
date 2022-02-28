const fs  = require('fs');
var request = require('request');
const { JSDOM } = require("jsdom");
const readline = require('readline');
var count = 0;
var total = 0;
var failed = 0;
var maxthreads = 50;
var threads = [];
var loadLength = 100;
async function download(email, password){
    var cookie = await login(email, password)
    if(!cookie) {
        process.exit(0);
    }
    console.log("\nCollecting Metadata...");
    let classes = await getClassrooms(cookie);
    var meta = [];
    for(let classroom of classes) {
        let qids = await getQids(cookie, classroom);
        if(qids.size<12){
            total += qids.size;
            meta.push([classroom[1], qids]);
        }
    }
    console.log("Metadata collected. Found "+total+" assignments in "+meta.length+" classrooms.");
    if(total){
        console.log("Starting Download ;)")
        divideTask(meta, cookie);
        startThreads();
    }
    else {
        console.log("No assignment found");
        process.exit(0);
    }
}
function login (email, password) {
    return new Promise(function (resolve, reject) {
        request.post('https://www.onlinegdb.com/login', {
        headers: {
            'Content-Type':'application/x-www-form-urlencoded'
        },
        form: {
            'email': email,
            'password': password,
        }
        }, (error, response, body) => {
            if(!response) {
                console.log("There was an error in login Process, check your connection.")
                resolve(null);
                return;
            }
            if(response.statusCode == 302){
                console.log("Logged In!");
                let cook = response.headers['set-cookie'][0];
                resolve(cook);
            }
            else {
                console.log("There was an error in login Process, check your credentials");
                resolve(null);
                return;
            }
        });
    })
}
function startThreads() {
    threads.forEach( thread => {
        runThread(thread);
    })
}
async function runThread(thread){
    for(let data of thread){
        await saveQuestion(data.cookie, data.route, data.className);
    }
}
function divideTask(meta, cookie) {
    if(maxthreads<1){
        console.log("No thread to download.");
        process.exit(0);
    }
    let threadIndex = 0;
    for(let i=0; i<maxthreads; ++i){
        threads[i] = [];
    }
    meta.forEach( classroom => {
        classroom[1].forEach( route => {
            threads[threadIndex]?.push({cookie:cookie, className:classroom[0], route:route});
            threadIndex = (threadIndex+1)%maxthreads;
        });
    });
}
function clean(str=""){
    str = str.trim();
    let k = "";
    for(let i=0;i<str.length;i++){
        if(" \n/\\".indexOf(str[i])==-1) k+=str[i];
    }
    return k;
}
function formatData(element){
    let data = "";
    let paras = [...element.getElementsByTagName("p")];
    paras.forEach( para => {
        data += para.textContent + '\n';
    })
    return data;
}
async function getClassrooms(cookie) {
    return new Promise((resolve,reject)=>{
        request.get('https://www.onlinegdb.com/classroom',{
            headers: {
                'cookie': cookie
            },
        }, (error,res,body) => {
            let classes = new Set();
            if(!res || error) {
                console.log("Error in connecting to GDB. Try again later.");
                resolve(classes);
                return ;
            }
            let document = (new JSDOM(body)).window.document;
            [...document.getElementsByClassName("list-group-item")].forEach((element) => {
                classes.add([element.getAttribute("data-uid"),clean(element.textContent)]);
            })
            if(classes.size) 
                resolve(classes);
            else {
                console.log("No classroom found.");
                return ;
            }
        })
    })
}
async function getQids(cookie, classroom) {
    return new Promise((resolve, reject)=>{
        request.get('https://www.onlinegdb.com/s/classroom/'+classroom[0],{
            headers: {
                'cookie': cookie
            },
        }, (error,res,body) => {
            let routes = new Set();
            if(error) {
                resolve(routes);
                return;
            }
            body = body.toString();
            let i = body.indexOf("href=\"/s/as/");
            while(i!=-1){
                routes.add(parseInt(body.substr(i+12,5)))
                i = body.indexOf("href=\"/s/as/",i+20);
            }
            resolve(routes);
        })
    });
}
let ccount = 0;
function updateOnCodeWrite(){
    ccount++;
    if(ccount == total && count == total) {
        console.log('\n');
        console.log(total-failed+" assignments downloaded.");
        console.log(failed + " failed to download.")
        process.exit(0);
    }
}
function updateOnFileWrite(){
    count++;
    let per = Math.ceil(loadLength*count/total);
    equals = "";
    spaces = "";
    for(let i=0;i<per;i++) equals += '=';
    for(;per<loadLength;per++) spaces += ' ';
    if(count>1) process.stdout.write("\r\x1b[K");
    process.stdout.write("["+equals + spaces+"]"+count);
    if(ccount == total && count == total) {
        console.log('\n');
        console.log(total-failed+" assignments downloaded.");
        console.log(failed + " failed to download.")
        process.exit(0);
    }
}
async function saveQuestion(cookie, route, className) {
    if(!fs.existsSync(className+'/')){
        fs.mkdirSync(className+'/');
    }
    return new Promise((resolve, reject) =>{
        request.get('https://www.onlinegdb.com/s/as/'+route,{
            headers: {
                'cookie': cookie
            },
        }, async (e,res,body) => {
            if(e){
                failed ++;
                updateOnCodeWrite();
                updateOnFileWrite();
                resolve();
                return;
            }
            var doc = new JSDOM(body).window.document;
            let qdata = formatData(doc.getElementsByClassName("row")[2]?.getElementsByClassName("form-group")[1]?.children[0]);
            let qname = clean(doc.getElementsByClassName("row")[2]?.getElementsByClassName("form-group")[0]?.textContent);
            qdata = qdata.trim();
            let { code, lang } = await fetchCode(cookie, route);
            if(code?.length) 
                qdata += "\n\n\n\n\nYour Code:\n" + code;
            if(qname && qdata)
                fs.writeFile(className+'/'+qname+'.txt', qdata, err => console.error(err), updateOnFileWrite);
            if(code?.length)
                fs.writeFile(className+'/'+qname+'.'+lang, code, err => console.error(err), updateOnCodeWrite);
            resolve();
        })
    })
}
async function fetchCode(cookie, route) {
    return new Promise((resolve, reject) => {
        request.get('https://www.onlinegdb.com/s/as/solve/'+route+'?comment=true?snippet_type=&readonly=true&preview=',{
                headers: {
                    'cookie': cookie
                },
                // timeout: 5000
            }, (e,res,body) => {
                if(!res || !body) {
                    resolve({code:null,lang:null});
                }
                var doc = new JSDOM(body).window.document;
                let code = doc.getElementById("editor_1")?.textContent;
                let lang = doc.getElementsByClassName("filename")[0]?.textContent;
                if(lang) lang = lang.substring(lang.indexOf('.')+1);
                else lang = null;
                resolve({code:code,lang:lang});
            })
    })
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter credetials for GDB\nEmail : ', email => {
    rl.question('password : ', password => {
        setTimeout(()=>{
            console.log("Press Ctrl C to exit.. There might be an error if it is taking to long \n--Try lowering threadCount(maxThreads) before trying again.");
        },2*60*1000);
        download(email, password);
        rl.close();
    });
});