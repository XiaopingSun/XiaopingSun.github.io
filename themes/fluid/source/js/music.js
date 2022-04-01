const ap = new APlayer({
    container: document.getElementById('aplayer'),
    fixed: true,
	autoplay: true, //自动播放
    audio: [{
        name: 'Pursue',
        artist: '李鑫',
        url: 'https://hexo.qiniu.pursue.show/Pursue.mp3',
        cover: 'https://hexo.qiniu.pursue.show/portrait.png',
    }]
});
