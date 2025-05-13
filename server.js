const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');
const os = require('os');

// 优化获取本机无线局域网 IP 地址的函数
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    // 优先检查 WLAN 网络接口
    const preferredInterface = 'WLAN';
    const ifaceList = interfaces[preferredInterface];
    if (ifaceList) {
        for (const iface of ifaceList) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    // 如果 WLAN 接口没有找到，遍历所有接口
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const localIP = getLocalIP();

app.use(express.static(path.join(__dirname, '.')));

// 修改 players 为 Map（替换原数组）
let players = new Map(); // key: 玩家名，value: socket.id
// 定义 games 变量
let games = {};

// 优化 getSocketByPlayerName 函数
function getSocketByPlayerName(name) {
    const socketId = players.get(name); // 通过玩家名获取对应的 socket.id
    return socketId ? io.sockets.sockets.get(socketId) : undefined; // 通过 socket.id 获取 socket 对象
}

const questions = [
    {
        id: 1,
        question: '世界上最大的海洋是？',
        options: ['大西洋', '印度洋', '太平洋', '北冰洋'],
        answer: '太平洋'
    },
    {
        id: 2,
        question: '哪个国家的首都是巴黎？',
        options: ['英国', '法国', '德国', '意大利'],
        answer: '法国'
    },
    {
        id: 3,
        question: '哪种动物被称为"沙漠之舟"？',
        options: ['骆驼', '马', '牛', '羊'],
        answer: '骆驼'
    },
    {
        id: 4,
        question: '一年中哪个月份有 28 天？',
        options: ['只有 2 月', '所有月份', '4 月', '6 月'],
        answer: '所有月份'
    },
    {
        id: 5,
        question: '哪个行星是太阳系中最大的行星？',
        options: ['金星', '火星', '木星', '土星'],
        answer: '木星'
    }
];

io.on('connection', (socket) => {
    console.log('新的连接建立，socket ID:', socket.id);
    // 新连接建立时，先以 socket.id 作为临时键存储
    players.set(socket.id, socket.id);

    socket.on('login', (name) => {
        console.log('玩家登录:', name, 'socket ID:', socket.id);
        // 玩家登录后，更新 players Map，删除临时记录
        players.delete(socket.id);
        if (!players.has(name)) {
            players.set(name, socket.id);
        }
        socket.playerName = name;
        console.log('设置socket.playerName:', socket.playerName);
        console.log('当前玩家列表:', Array.from(players.keys()));
        io.emit('player-list', Array.from(players.keys()));
    });

    socket.on('challenge', (data) => {
        console.log('收到挑战请求:', data);
        const { challenger, opponent } = data;
        console.log('当前在线玩家:', Array.from(players.keys()));
        console.log('当前所有socket连接:', Array.from(players.values()));
        const opponentSocket = getSocketByPlayerName(opponent);
        
        if (opponentSocket) {
            console.log('找到对手socket，发送挑战请求');
            // 关键修改：将事件名从 'challenge-accepted' 改为 'challenge-received'
            opponentSocket.emit('challenge-received', {
                challenger: challenger,
                opponent: opponent
            });
        } else {
            console.log('未找到对手socket，通知挑战者');
            socket.emit('challenge-failed', { 
                message: '对手不在线' 
            });
        }
    });

    socket.on('challenge-received', (data) => {
        console.log('挑战被接受:', data);
        const { challenger, opponent } = data;
        
        // 创建新的游戏
        games[`${challenger}-${opponent}`] = {
            challenger,
            opponent,
            scores: { [challenger]: 0, [opponent]: 0 },
            questionIndex: 0
        };

        // 通知双方游戏开始
        const challengerSocket = getSocketByPlayerName(challenger);
        const opponentSocket = getSocketByPlayerName(opponent);
        
        if (challengerSocket) {
            challengerSocket.emit('game-start', questions[0]);
            challengerSocket.emit('challenge-received', { opponent: opponent });
        }
        if (opponentSocket) {
            opponentSocket.emit('game-start', questions[0]);
            opponentSocket.emit('challenge-received', { opponent: challenger });
        }
    });

    socket.on('challenge-rejected', (data) => {
        console.log('挑战被拒绝:', data);
        const { challenger, opponent } = data;
        
        // 通知挑战者挑战被拒绝
        const challengerSocket = getSocketByPlayerName(challenger);
        if (challengerSocket) {
            challengerSocket.emit('challenge-rejected', { 
                opponent: opponent,
                message: `${opponent} 拒绝了你的挑战请求`
            });
        }
    });

    socket.on('answer', (data) => {
        const { player, answer, questionId } = data;
        const gameKey = Object.keys(games).find(key => key.includes(player));
        if (gameKey) {
            const game = games[gameKey];
            const otherPlayer = game.challenger === player? game.opponent : game.challenger;
            const question = questions.find(q => q.id === questionId);
            if (question) {
                let winner;
                let points;
                let message;
                if (answer === question.answer) {
                    winner = player;
                    points = 2;
                    message = `${player} 回答正确，获得 2 分！`;
                } else {
                    winner = otherPlayer;
                    points = 1;
                    message = `${player} 回答错误，${otherPlayer} 获得 1 分！`;
                }
                game.scores[winner] += points;
                const challengerSocket = getSocketByPlayerName(game.challenger);
                const opponentSocket = getSocketByPlayerName(game.opponent);
                if (challengerSocket) challengerSocket.emit('round-result', { winner, points, message });
                if (opponentSocket) opponentSocket.emit('round-result', { winner, points, message });
            }
        }
    });

    socket.on('next-question', (data) => {
        const { challenger, opponent } = data;
        const gameKey = `${challenger}-${opponent}`;
        const game = games[gameKey];
        if (game.questionIndex < questions.length - 1) {
            game.questionIndex++;
            const question = questions[game.questionIndex];
            const challengerSocket = getSocketByPlayerName(challenger);
            const opponentSocket = getSocketByPlayerName(opponent);
            if (challengerSocket) challengerSocket.emit('game-start', question);
            if (opponentSocket) opponentSocket.emit('game-start', question);
        } else {
            const { scores } = game;
            let winner;
            if (scores[challenger] > scores[opponent]) {
                winner = challenger;
            } else if (scores[opponent] > scores[challenger]) {
                winner = opponent;
            } else {
                winner = '平局';
            }
            const challengerSocket = getSocketByPlayerName(challenger);
            const opponentSocket = getSocketByPlayerName(opponent);
            if (challengerSocket) challengerSocket.emit('game-end', winner);
            if (opponentSocket) opponentSocket.emit('game-end', winner);
            delete games[gameKey];
        }
    });

    socket.on('connect_error', (error) => {
        console.error('连接错误:', error);
        // 尝试重新连接
        setTimeout(() => {
            socket.connect();
        }, 1000);
    });

    socket.on('disconnect', () => {
        console.log('与服务器断开连接，socket ID:', socket.id);
        if (socket.playerName) {
            players.delete(socket.playerName);
        } else {
            // 如果玩家未登录就断开连接，删除临时记录
            players.delete(socket.id);
        }
        io.emit('player-list', Array.from(players.keys())); // 广播更新后的列表
        console.log(`玩家 ${socket.playerName || socket.id} 已断开连接`);
    });
});

const port = process.env.PORT || 3000;
http.listen(port, '0.0.0.0', () => {
    console.log(`服务器运行在端口 ${port}，可以通过 http://${localIP}:${port} 访问`);
});    
    