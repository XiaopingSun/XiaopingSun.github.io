const ap = new APlayer({
    container: document.getElementById('aplayer'),
    fixed: true,
	autoplay: false, //自动播放
    audio: [{
        name: 'Pursue',
        artist: '李鑫',
        url: '/resources/music/Pursue.mp3',
        cover: '/resources/music/portrait.png',
    }]
});
