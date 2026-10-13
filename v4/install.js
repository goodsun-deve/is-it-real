// v4 "앱으로 설치하기" 버튼 — 기기·브라우저마다 다르게 동작합니다.
//  1) 안드로이드 크롬 등: 설치 창을 바로 띄움 (beforeinstallprompt)
//  2) 아이폰 사파리: '홈 화면에 추가' 방법 안내
//  3) 카카오톡 등 앱 안 브라우저: '다른 브라우저로 열기' 안내
//  4) 이미 설치한 앱으로 열었을 때: 버튼 숨김
(function(){
  var row   = document.getElementById('installRow');
  var btn   = document.getElementById('installBtn');
  var back  = document.getElementById('guideBack');
  var title = document.getElementById('guideTitle');
  var body  = document.getElementById('guideBody');
  var close = document.getElementById('guideClose');
  if (!row || !btn || !back) return;

  var ua = navigator.userAgent || '';

  function isStandalone(){
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (e) {}
    return window.navigator.standalone === true; // 아이폰 홈 화면 앱
  }

  var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
              (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1); // 아이패드(데스크톱 모드)
  var isAndroid = /Android/i.test(ua);
  var isKakao = /KAKAOTALK/i.test(ua);
  // 카카오톡 외 자주 쓰는 앱 안 브라우저들
  var isInApp = isKakao ||
    /NAVER\(inapp|DaumApps|Instagram|FBAN|FBAV|FB_IAB|Line\/|everytimeApp|BAND\/|KAKAOSTORY|Whale\/.*inapp|; wv\)/i.test(ua);

  // 4) 이미 설치된 앱으로 열었으면 버튼을 아예 숨김
  if (isStandalone()) return;

  row.hidden = false;

  // 1) 설치 가능한 브라우저: 설치 이벤트를 받아 둠
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener('appinstalled', function(){
    deferred = null;
    row.hidden = true;
    hideGuide();
  });

  function showGuide(heading, html){
    title.textContent = heading;
    body.innerHTML = html;
    back.hidden = false;
    close.focus();
  }
  function hideGuide(){ back.hidden = true; }
  close.addEventListener('click', hideGuide);
  back.addEventListener('click', function(e){ if (e.target === back) hideGuide(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hideGuide(); });

  btn.addEventListener('click', function(){
    // 3) 카카오톡 등 앱 안 브라우저 — 여기서는 설치가 안 됨
    if (isInApp){
      var where = isIOS ? '오른쪽 아래' : '오른쪽 위나 아래';
      showGuide('여기서는 설치가 안 돼요',
        '<ol>' +
          '<li>' + where + ' <b>점 3개(⋮ 또는 ···)</b>를 누르세요</li>' +
          '<li><b>\'다른 브라우저로 열기\'</b>를 누르세요</li>' +
          '<li>새로 열린 화면에서 <b>이 버튼을 다시</b> 눌러 주세요</li>' +
        '</ol>' +
        '<p>메뉴 이름이 조금 다를 수 있어요. \'브라우저로 열기\', \'크롬으로 열기\', \'Safari로 열기\'를 찾으세요.</p>');
      return;
    }

    // 1) 안드로이드 크롬 등: 설치 창 바로 띄우기
    if (deferred){
      var ev = deferred;
      deferred = null;
      ev.prompt();
      if (ev.userChoice && ev.userChoice.then){
        ev.userChoice.then(function(c){
          if (c && c.outcome === 'accepted') row.hidden = true;
        }).catch(function(){});
      }
      return;
    }

    // 2) 아이폰·아이패드
    if (isIOS){
      showGuide('아이폰에 설치하는 방법',
        '<ol>' +
          '<li>화면 아래쪽 <b>공유 버튼(□↑)</b>을 누르세요</li>' +
          '<li>목록을 위로 밀어서 <b>\'홈 화면에 추가\'</b>를 누르세요</li>' +
          '<li>오른쪽 위 <b>\'추가\'</b>를 누르면 끝!</li>' +
        '</ol>' +
        '<p>공유 버튼이 안 보이면 아래쪽 <b>점 3개(···)</b>를 먼저 누르세요.</p>');
      return;
    }

    // 안드로이드인데 설치 창이 준비되지 않은 경우 (삼성 인터넷, 이미 설치됨 등)
    if (isAndroid){
      showGuide('휴대폰에 설치하는 방법',
        '<ol>' +
          '<li>오른쪽 위나 아래 <b>점 3개(⋮) 또는 줄 3개(≡)</b>를 누르세요</li>' +
          '<li><b>\'홈 화면에 추가\'</b> 또는 <b>\'앱 설치\'</b>를 누르세요</li>' +
          '<li><b>\'설치\'</b> 또는 <b>\'추가\'</b>를 누르면 끝!</li>' +
        '</ol>' +
        '<p>이미 설치했다면 휴대폰 홈 화면에서 <b>\'진짜일까?\'</b> 아이콘을 찾아 보세요.</p>');
      return;
    }

    // 컴퓨터 등 그 밖의 경우
    showGuide('설치하는 방법',
      '<p>주소창 오른쪽의 <b>설치 아이콘</b>이나 브라우저 메뉴의 <b>\'앱 설치\'</b>를 눌러 주세요.</p>' +
      '<p>휴대폰에서 여시면 더 쉽게 설치할 수 있어요.</p>');
  });
})();

// v4 전용 서비스 워커 (/v4/ 범위만 담당 — 원본·v2·v3에는 영향 없음)
if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('/v4/sw.js', { scope: '/v4/' }).catch(function(){});
  });
}
