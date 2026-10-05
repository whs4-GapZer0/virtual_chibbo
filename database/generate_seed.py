#!/usr/bin/env python3
"""Generate database/seed.synthetic.sql.

Everything here is invented. Applicant e-mail addresses use the RFC 2606
reserved example domains and phone numbers use the unassigned 010-0000 block,
so no generated contact detail can reach a real person. The output is
deterministic: rerunning the generator produces the same file.

    python3 database/generate_seed.py > database/seed.synthetic.sql
"""
import random

rng = random.Random(20261005)


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def arr(items):
    return "ARRAY[" + ",".join(q(i) for i in items) + "]::text[]" if items else "'{}'::text[]"


PROCESS_STANDARD = ["서류 검토", "1차 실무 면접", "2차 문화 면접", "처우 협의", "최종 합격"]
PROCESS_TASK = ["서류 검토", "사전 과제", "실무 면접", "임원 면접", "최종 합격"]
PROCESS_SHORT = ["서류 검토", "실무 면접", "최종 합격"]

COMPANIES = [
    dict(n=1, slug="alpha-works", name="알파웍스", industry="HR SaaS", location="서울 성동구", scale="120명", founded=2018,
         tagline="채용 담당자의 하루를 줄이는 HR 소프트웨어",
         description="알파웍스는 중견·중소기업을 위한 채용 관리 소프트웨어를 만듭니다. 공고 등록부터 지원자 심사, 합격 통보까지 한 화면에서 처리하도록 돕고, 현재 600여 개 고객사가 사용하고 있습니다.",
         benefits=["주 2회 재택근무", "점심 식대 월 20만 원", "업무 장비 선택 지원", "연 150만 원 교육비", "건강검진 연 1회"]),
    dict(n=2, slug="beta-studio", name="베타스튜디오", industry="디자인 에이전시", location="서울 마포구", scale="38명", founded=2015,
         tagline="브랜드와 제품 경험을 함께 설계하는 디자인 스튜디오",
         description="베타스튜디오는 브랜드 아이덴티티와 디지털 제품 디자인을 함께 다루는 스튜디오입니다. 금융, 커머스, 공공 분야 고객과 장기 프로젝트를 주로 진행합니다.",
         benefits=["시차 출퇴근제", "프로젝트 종료 후 리프레시 휴가", "디자인 도서·폰트 구입 지원", "야근 시 택시비 지원"]),
    dict(n=3, slug="gamma-logics", name="감마로직스", industry="물류 플랫폼", location="경기 성남시 분당구", scale="260명", founded=2016,
         tagline="당일 배송을 가능하게 하는 풀필먼트 네트워크",
         description="감마로직스는 수도권 7개 풀필먼트 센터와 자체 배차 시스템으로 온라인 판매자의 입고, 보관, 출고를 대행합니다. 하루 평균 9만 건의 주문을 처리합니다.",
         benefits=["사내 카페·구내식당 무료", "통근 셔틀 운영", "자녀 학자금 지원", "분기별 성과급", "단체 상해보험"]),
    dict(n=4, slug="delta-commerce", name="델타커머스", industry="이커머스", location="서울 강남구", scale="430명", founded=2013,
         tagline="취향을 발견하는 라이프스타일 쇼핑",
         description="델타커머스는 리빙·패션 편집숍 앱을 운영합니다. 월 280만 명이 방문하며, 입점 브랜드 4,200곳과 함께 성장하고 있습니다.",
         benefits=["자사몰 포인트 연 120만 원", "선택적 근로시간제", "점심·저녁 식대 지원", "사내 동호회 지원", "장기근속 포상 휴가"]),
    dict(n=5, slug="epsilon-health", name="엡실론헬스", industry="디지털 헬스케어", location="대전 유성구", scale="74명", founded=2020,
         tagline="만성질환 관리를 일상으로 가져옵니다",
         description="엡실론헬스는 당뇨·고혈압 환자를 위한 생활습관 코칭 앱과 병원 연동 대시보드를 제공합니다. 전국 90여 개 의원과 협력하고 있습니다.",
         benefits=["전 직원 스톡옵션", "주 4.5일 근무", "본인·가족 의료비 지원", "이주 정착금 지원"]),
    dict(n=6, slug="zeta-mobility", name="제타모빌리티", industry="모빌리티", location="부산 해운대구", scale="150명", founded=2019,
         tagline="도시의 짧은 이동을 다시 설계합니다",
         description="제타모빌리티는 부산·울산·경남 지역에서 공유 전기자전거와 수요응답형 버스를 운영합니다. 지자체와 함께 교통 취약 지역의 이동 문제를 풉니다.",
         benefits=["서비스 무제한 이용권", "유연근무제", "기숙사 제공(신입 1년)", "명절 선물·경조사 지원"]),
]

# slug, title, work_type, department, location, career_level, salary, headcount, closes_in_days, published_days_ago, tags, description, responsibilities, requirements, preferred, process
JOBS = {
    "alpha-works": [
        ("support-engineer", "고객지원 엔지니어", "정규직", "고객성공팀", "서울 성동구", "경력 2년 이상", "4,200만 ~ 5,500만 원", 2, 21, 9, ["SQL", "Zendesk", "API"],
         "고객 문의 해결과 지원 품질 개선을 함께합니다.",
         ["고객사 기술 문의 접수와 원인 분석, 해결 안내", "반복 문의를 줄이는 도움말 문서와 내부 진단 도구 개선", "장애 발생 시 고객 공지와 개발팀 간 상황 전달"],
         ["B2B 소프트웨어 기술 지원 경력 2년 이상", "SQL로 데이터를 조회하고 로그를 읽어 원인을 좁힐 수 있는 분", "고객에게 기술 내용을 쉬운 말로 설명할 수 있는 분"],
         ["HR 또는 채용 도메인 경험", "REST API 연동 지원 경험"], PROCESS_STANDARD),
        ("backend-engineer", "백엔드 엔지니어", "정규직", "플랫폼개발팀", "서울 성동구", "경력 3년 이상", "6,000만 ~ 8,500만 원", 3, 30, 4, ["TypeScript", "PostgreSQL", "AWS"],
         "채용지원 서비스의 안정적인 기반을 만듭니다.",
         ["지원서 접수·심사 API 설계와 운영", "멀티테넌트 데이터 격리와 권한 모델 개선", "배포 파이프라인과 관측 지표 관리"],
         ["서버 개발 경력 3년 이상", "관계형 데이터베이스 설계와 쿼리 튜닝 경험", "코드 리뷰와 테스트 작성이 습관인 분"],
         ["개인정보를 다루는 서비스 운영 경험", "AWS ECS, RDS 운영 경험"], PROCESS_TASK),
        ("security-engineer", "보안 엔지니어", "정규직", "보안팀", "서울 성동구", "경력 5년 이상", "7,000만 ~ 1억 원", 1, 14, 2, ["ISMS-P", "AWS", "취약점 관리"],
         "고객사의 지원자 정보를 지키는 보안 체계를 운영합니다.",
         ["클라우드 인프라 보안 설정 점검과 취약점 조치 관리", "접근 권한 검토와 로그 모니터링 체계 운영", "ISMS-P 인증 유지와 내부 감사 대응"],
         ["정보보호 실무 경력 5년 이상", "AWS 보안 서비스 운영 경험", "취약점 진단 결과를 개발팀과 조율해 조치한 경험"],
         ["ISMS-P 인증 심사 대응 경험", "정보보안기사 등 관련 자격"], PROCESS_STANDARD),
        ("hr-product-manager", "프로덕트 매니저", "정규직", "프로덕트팀", "서울 성동구", "경력 4년 이상", "6,500만 ~ 9,000만 원", 1, None, 16, ["B2B SaaS", "데이터 분석"],
         "채용 담당자의 심사 흐름을 책임지는 제품 로드맵을 이끕니다.",
         ["고객 인터뷰와 사용 데이터로 문제 정의", "분기 로드맵 수립과 우선순위 결정", "디자인·개발팀과 함께 기능 출시와 성과 측정"],
         ["B2B 제품 기획 경력 4년 이상", "가설을 세우고 지표로 검증한 경험", "여러 직군과 문서로 소통하는 데 익숙한 분"],
         ["HR 테크 또는 ATS 제품 경험"], PROCESS_STANDARD),
    ],
    "beta-studio": [
        ("product-designer", "프로덕트 디자이너", "계약직", "디지털제품팀", "서울 마포구", "경력 3년 이상", "월 450만 ~ 550만 원", 2, 18, 6, ["Figma", "디자인 시스템", "UX 리서치"],
         "지원자와 채용 담당자의 흐름을 설계합니다.",
         ["고객사 웹·앱 서비스의 화면 설계와 프로토타이핑", "디자인 시스템 컴포넌트 정의와 문서화", "사용성 테스트 계획과 결과 반영"],
         ["디지털 제품 디자인 경력 3년 이상", "Figma로 컴포넌트와 변수를 체계적으로 다루는 분", "설계 근거를 글과 말로 설명할 수 있는 분"],
         ["금융·공공 서비스 디자인 경험", "접근성 지침(KWCAG) 적용 경험"], PROCESS_TASK),
        ("brand-designer", "브랜드 디자이너", "정규직", "브랜드팀", "서울 마포구", "경력 2년 이상", "3,800만 ~ 5,000만 원", 1, 25, 11, ["BI", "편집 디자인", "모션"],
         "브랜드의 첫인상부터 운영 가이드까지 만듭니다.",
         ["브랜드 아이덴티티 개발과 가이드라인 제작", "인쇄물, 패키지, 공간 그래픽 등 응용 디자인", "촬영·영상 외주 디렉션"],
         ["브랜드 디자인 경력 2년 이상", "포트폴리오에 브랜드 개발 전 과정이 담긴 프로젝트가 있는 분"],
         ["모션 그래픽 제작 경험", "타이포그래피에 대한 깊은 이해"], PROCESS_STANDARD),
        ("project-manager", "프로젝트 매니저", "정규직", "운영팀", "서울 마포구", "경력 3년 이상", "4,500만 ~ 6,000만 원", 1, 10, 13, ["일정 관리", "고객 커뮤니케이션"],
         "프로젝트의 일정, 예산, 고객 소통을 책임집니다.",
         ["프로젝트 범위·일정·예산 수립과 관리", "고객사 정기 보고와 요청 사항 조율", "투입 인력 계획과 외주 파트너 관리"],
         ["에이전시 또는 SI 프로젝트 관리 경력 3년 이상", "견적과 계약 문서를 직접 작성해 본 분"],
         ["디자인 또는 개발 실무 경험"], PROCESS_SHORT),
    ],
    "gamma-logics": [
        ("warehouse-operations-manager", "풀필먼트 센터 운영 매니저", "정규직", "센터운영본부", "경기 이천시", "경력 5년 이상", "5,500만 ~ 7,000만 원", 2, 12, 7, ["WMS", "인력 운영", "안전 관리"],
         "이천 센터의 입출고 품질과 생산성을 책임집니다.",
         ["입고·보관·출고 공정 일일 운영과 지표 관리", "교대 근무 인력 편성과 협력업체 관리", "안전 점검과 사고 예방 활동"],
         ["물류센터 운영 경력 5년 이상", "50명 이상 현장 인력 관리 경험", "WMS 사용과 엑셀 데이터 분석에 능숙한 분"],
         ["물류관리사 자격", "자동화 설비 도입 경험"], PROCESS_SHORT),
        ("data-analyst", "데이터 분석가", "정규직", "데이터팀", "경기 성남시 분당구", "경력 2년 이상", "5,000만 ~ 6,800만 원", 1, 20, 3, ["SQL", "Python", "수요 예측"],
         "주문과 배차 데이터로 운영 의사결정을 돕습니다.",
         ["센터별 물동량 예측과 인력 계획 모델 개선", "배송 지연 원인 분석과 대시보드 운영", "실험 설계와 결과 해석"],
         ["데이터 분석 경력 2년 이상", "SQL과 Python을 실무에서 사용한 경험", "분석 결과를 비전문가에게 전달할 수 있는 분"],
         ["물류·유통 도메인 경험", "시계열 예측 모델링 경험"], PROCESS_TASK),
        ("android-engineer", "안드로이드 엔지니어", "정규직", "모바일개발팀", "경기 성남시 분당구", "경력 3년 이상", "6,000만 ~ 8,000만 원", 2, None, 19, ["Kotlin", "Jetpack Compose"],
         "배송 기사와 센터 작업자가 쓰는 앱을 만듭니다.",
         ["배송 기사용 앱의 경로 안내와 인수 확인 기능 개발", "바코드 스캔 등 현장 단말 연동", "오프라인 환경을 고려한 동기화 설계"],
         ["안드로이드 개발 경력 3년 이상", "Kotlin, Coroutine 사용 경험", "앱 성능과 안정성 지표를 관리해 본 분"],
         ["지도·위치 기반 서비스 개발 경험"], PROCESS_TASK),
    ],
    "delta-commerce": [
        ("md-living", "리빙 카테고리 MD", "정규직", "상품본부", "서울 강남구", "경력 3년 이상", "4,500만 ~ 6,500만 원", 2, 16, 5, ["상품 기획", "브랜드 소싱", "매출 분석"],
         "리빙 카테고리의 브랜드 입점과 기획전을 이끕니다.",
         ["신규 브랜드 발굴과 입점 협상", "시즌 기획전 구성과 가격 정책 수립", "카테고리 매출·재고 지표 분석"],
         ["온라인 커머스 MD 경력 3년 이상", "브랜드 협상과 계약을 직접 진행한 경험"],
         ["리빙·인테리어 분야 네트워크", "라이브 커머스 운영 경험"], PROCESS_STANDARD),
        ("frontend-engineer", "프론트엔드 엔지니어", "정규직", "웹개발팀", "서울 강남구", "경력 3년 이상", "6,000만 ~ 8,500만 원", 3, 28, 1, ["React", "Next.js", "웹 성능"],
         "월 280만 명이 쓰는 쇼핑 화면을 빠르고 쓰기 쉽게 만듭니다.",
         ["상품 탐색·주문 화면 개발과 성능 개선", "디자인 시스템 컴포넌트 구현", "A/B 테스트 기반 기능 개선"],
         ["프론트엔드 개발 경력 3년 이상", "React와 TypeScript 실무 경험", "웹 성능 지표를 측정하고 개선해 본 분"],
         ["대규모 트래픽 서비스 경험", "웹 접근성 개선 경험"], PROCESS_TASK),
        ("cs-lead", "고객센터 파트장", "정규직", "고객경험팀", "서울 강남구", "경력 6년 이상", "5,000만 ~ 6,500만 원", 1, 9, 12, ["CS 운영", "VOC 분석"],
         "상담 품질과 고객 불만 처리 체계를 책임집니다.",
         ["상담 인력 20명 규모 파트 운영", "응대 품질 기준 수립과 모니터링", "VOC 분석 결과를 서비스 개선 과제로 연결"],
         ["고객센터 운영 경력 6년 이상", "상담 조직 관리 경험 2년 이상"],
         ["커머스 반품·환불 정책 수립 경험"], PROCESS_SHORT),
        ("marketing-intern", "퍼포먼스 마케팅 인턴", "인턴", "마케팅팀", "서울 강남구", "신입", "월 230만 원", 2, 7, 8, ["광고 운영", "GA4"],
         "광고 캠페인 운영을 가까이에서 배우는 3개월 인턴십입니다.",
         ["광고 소재 등록과 일일 성과 리포트 작성", "경쟁사·키워드 조사", "프로모션 페이지 검수"],
         ["기졸업자 또는 졸업 예정자", "엑셀 함수와 피벗 테이블을 다룰 수 있는 분"],
         ["광고 플랫폼 운영 경험", "데이터 분석 관련 수강 이력"], PROCESS_SHORT),
    ],
    "epsilon-health": [
        ("clinical-coach", "임상 코치 (간호사)", "정규직", "케어운영팀", "대전 유성구", "경력 3년 이상", "4,000만 ~ 5,200만 원", 3, 22, 10, ["간호사 면허", "만성질환 교육"],
         "앱 이용 환자의 생활습관 개선을 1:1로 돕습니다.",
         ["환자 혈당·혈압 기록 검토와 메시지 코칭", "교육 콘텐츠 감수", "협력 의원 의료진과 환자 상태 공유"],
         ["간호사 면허 소지", "내과 또는 내분비 병동·외래 경력 3년 이상"],
         ["당뇨병 교육자 자격", "비대면 상담 경험"], PROCESS_STANDARD),
        ("ios-engineer", "iOS 엔지니어", "정규직", "앱개발팀", "대전 유성구 (원격 가능)", "경력 2년 이상", "5,500만 ~ 7,500만 원", 1, None, 15, ["Swift", "HealthKit"],
         "환자가 매일 여는 건강 기록 앱을 만듭니다.",
         ["혈당계·혈압계 연동과 기록 화면 개발", "알림과 위젯으로 기록 습관 형성 지원", "의료 데이터 보호 요건에 맞춘 저장·전송 구현"],
         ["iOS 개발 경력 2년 이상", "Swift, SwiftUI 실무 경험"],
         ["HealthKit 또는 BLE 기기 연동 경험", "헬스케어 규제 환경 이해"], PROCESS_TASK),
        ("privacy-officer", "개인정보보호 담당자", "정규직", "경영지원팀", "대전 유성구", "경력 4년 이상", "5,500만 ~ 7,000만 원", 1, 15, 2, ["개인정보보호법", "의료 데이터", "ISMS-P"],
         "민감한 건강 정보를 안전하게 다루는 기준을 세우고 운영합니다.",
         ["개인정보 처리방침과 동의 절차 관리", "개인정보 영향평가와 수탁사 점검", "정보주체 권리 행사 요청 처리"],
         ["개인정보보호 실무 경력 4년 이상", "민감정보 처리 서비스에서 근무한 경험"],
         ["CPPG 등 관련 자격", "의료법·생명윤리법 실무 이해"], PROCESS_STANDARD),
    ],
    "zeta-mobility": [
        ("field-operations", "현장 운영 매니저", "정규직", "운영본부", "부산 해운대구", "경력 2년 이상", "3,800만 ~ 4,800만 원", 2, 13, 6, ["현장 관리", "정비 일정"],
         "공유 전기자전거의 배치, 충전, 정비 일정을 운영합니다.",
         ["권역별 기기 재배치와 충전 계획 수립", "정비 협력업체 일정과 품질 관리", "민원과 방치 기기 신고 대응"],
         ["현장 운영 또는 물류 관리 경력 2년 이상", "1종 보통 운전면허"],
         ["모빌리티·배달 플랫폼 운영 경험"], PROCESS_SHORT),
        ("public-partnership", "지자체 협력 담당", "정규직", "사업개발팀", "부산 해운대구", "경력 4년 이상", "5,000만 ~ 6,500만 원", 1, 19, 14, ["공공 사업", "제안서"],
         "지자체와 함께 수요응답형 버스 사업을 넓힙니다.",
         ["지자체 교통 부서 대상 제안과 협약 체결", "공공 입찰 제안서 작성", "시범 사업 성과 보고"],
         ["공공 사업 제안 또는 대관 경력 4년 이상", "제안서와 보고서 작성에 능숙한 분"],
         ["교통·도시계획 전공", "국고보조사업 수행 경험"], PROCESS_STANDARD),
        ("embedded-engineer", "임베디드 엔지니어", "계약직", "하드웨어팀", "부산 해운대구", "경력 3년 이상", "월 500만 ~ 600만 원", 1, 26, 3, ["C", "RTOS", "BLE"],
         "전기자전거 잠금장치와 통신 모듈의 펌웨어를 개발합니다.",
         ["잠금장치·배터리 관리 펌웨어 개발", "LTE-M, BLE 통신 안정화", "현장 고장 로그 분석과 원격 업데이트"],
         ["임베디드 펌웨어 개발 경력 3년 이상", "C 언어와 RTOS 사용 경험"],
         ["저전력 설계 경험", "양산 제품 펌웨어 유지보수 경험"], PROCESS_TASK),
    ],
}

SURNAMES = [("김", "kim"), ("이", "lee"), ("박", "park"), ("최", "choi"), ("정", "jung"), ("강", "kang"), ("조", "cho"), ("윤", "yoon"), ("장", "jang"), ("임", "lim"), ("한", "han"), ("오", "oh"), ("서", "seo"), ("신", "shin"), ("권", "kwon"), ("황", "hwang")]
GIVEN = [("민준", "minjun"), ("서연", "seoyeon"), ("도윤", "doyun"), ("지우", "jiwoo"), ("하준", "hajun"), ("서윤", "seoyun"), ("예준", "yejun"), ("지민", "jimin"), ("수아", "sua"), ("현우", "hyunwoo"), ("채원", "chaewon"), ("지호", "jiho"), ("유진", "yujin"), ("성민", "sungmin"), ("은지", "eunji"), ("태현", "taehyun"), ("소영", "soyoung"), ("재훈", "jaehoon"), ("미경", "mikyung"), ("동현", "donghyun"), ("혜진", "hyejin"), ("상우", "sangwoo"), ("나연", "nayeon"), ("준호", "junho")]
DOMAINS = ["example.com", "example.net", "example.org"]
ADDRESSES = ["서울특별시 마포구 새벽길 {n}", "서울특별시 성동구 물빛로 {n}", "서울특별시 관악구 푸른언덕길 {n}", "서울특별시 송파구 한솔로 {n}", "경기도 성남시 분당구 느티나무로 {n}", "경기도 수원시 영통구 달빛로 {n}", "경기도 고양시 일산동구 호수마을길 {n}", "인천광역시 연수구 바다숲로 {n}", "대전광역시 유성구 은하수로 {n}", "대구광역시 수성구 들꽃길 {n}", "부산광역시 해운대구 파도소리로 {n}", "부산광역시 남구 등대길 {n}", "광주광역시 북구 무등숲길 {n}", "울산광역시 남구 고래마을로 {n}"]
SCHOOLS = ["한빛대학교", "새솔대학교", "가람대학교", "누리대학교", "다온대학교", "미르대학교", "라온과학기술대학교", "한울대학교"]
MAJORS = ["경영학과", "컴퓨터공학과", "산업디자인학과", "통계학과", "간호학과", "산업공학과", "심리학과", "전자공학과", "국어국문학과", "도시공학과"]
DEGREES = ["학사", "학사", "학사", "석사", "전문학사"]
EMPLOYERS = ["오로라소프트", "블루핀테크", "모닝글로리", "스텔라유통", "노바시스템즈", "그린웨이브", "하늘물산", "세븐힐즈", "코랄미디어", "루트앤브랜치", "파인트리랩", "미도리푸드"]
STATUSES = ["submitted"] * 9 + ["reviewing"] * 6 + ["accepted"] * 2 + ["rejected"] * 3
BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def applicants():
    used = set()
    serial = 0
    for company in COMPANIES:
        for job in JOBS[company["slug"]]:
            for _ in range(rng.randint(1, 4)):
                while True:
                    surname, given = rng.choice(SURNAMES), rng.choice(GIVEN)
                    if (surname[0], given[0]) not in used:
                        used.add((surname[0], given[0]))
                        break
                serial += 1
                is_entry = job[5] == "신입"
                years = 0 if is_entry else rng.randint(1, 14)
                age = 23 + years + rng.randint(0, 4)
                employer = None if years == 0 else rng.choice(EMPLOYERS)
                summary = "관련 인턴과 교내 프로젝트 경험이 있습니다." if years == 0 else f"{employer}에서 {job[3].replace('팀', '').replace('본부', '')} 관련 업무를 {min(years, rng.randint(1, 6))}년간 맡았습니다."
                yield dict(
                    serial=serial, company=company, job_slug=job[0],
                    name=surname[0] + given[0],
                    email=f"{given[1]}.{surname[1]}{rng.randint(10, 99)}@{rng.choice(DOMAINS)}",
                    phone=f"010-0000-{rng.randint(0, 9999):04d}",
                    birth=f"{2026 - age}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
                    address=rng.choice(ADDRESSES).format(n=rng.randint(3, 240)),
                    education=f"{rng.choice(SCHOOLS)} {rng.choice(MAJORS)} {rng.choice(DEGREES)}",
                    years=years, employer=employer, summary=summary,
                    status=rng.choice(STATUSES),
                    receipt="CH-" + "".join(rng.choice(BASE32) for _ in range(8)) + "-" + "".join(rng.choice("0123456789ABCDEF") for _ in range(6)),
                    hours_ago=rng.randint(3, 24 * 28),
                )


def company_id(n):
    return f"00000000-0000-4000-8000-{n:012d}"


def main():
    out = []
    out.append("-- Synthetic Chibbo PoC seed. GENERATED by database/generate_seed.py; edit the")
    out.append("-- generator, not this file. Every person, company and contact detail is")
    out.append("-- invented: e-mail uses RFC 2606 example domains and phone numbers use the")
    out.append("-- unassigned 010-0000 block. Idempotent, so the approved migration can be retried.")
    out.append("-- Seeded applications are inserted once and never overwritten, so staff status")
    out.append("-- changes survive a re-run.")
    out.append("SET ROLE chibbo_owner;")
    out.append("SET search_path = chibbo, pg_catalog;")
    rows = ",\n".join(
        f"({q(company_id(c['n']))},{q(c['name'])},{q(c['slug'])},{q(c['tagline'])},{q(c['description'])},{q(c['industry'])},{q(c['location'])},{q(c['scale'])},{c['founded']},{q('https://' + c['slug'] + '.example')},{arr(c['benefits'])})"
        for c in COMPANIES)
    out.append("INSERT INTO companies (id,name,slug,tagline,description,industry,location,employee_scale,founded_year,homepage_url,benefits) VALUES\n" + rows)
    out.append("ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, status='active', tagline=EXCLUDED.tagline, description=EXCLUDED.description, industry=EXCLUDED.industry, location=EXCLUDED.location, employee_scale=EXCLUDED.employee_scale, founded_year=EXCLUDED.founded_year, homepage_url=EXCLUDED.homepage_url, benefits=EXCLUDED.benefits;")
    people = list(applicants())
    for c in COMPANIES:
        cid = company_id(c["n"])
        out.append("BEGIN;")
        out.append(f"SELECT set_config('app.company_id', {q(cid)}, true);")
        rows = []
        for (slug, title, work_type, dept, loc, level, salary, headcount, closes, published, tags, desc, resp, reqs, pref, process) in JOBS[c["slug"]]:
            closes_sql = "NULL" if closes is None else f"date_trunc('day', now()) + interval '{closes} days' + interval '14 hours 59 minutes'"
            rows.append(f"({q(cid)},{q(slug)},{q(title)},{q(desc)},{q(work_type)},{q(dept)},{q(loc)},{q(level)},{q(salary)},{headcount},{arr(resp)},{arr(reqs)},{arr(pref)},{arr(process)},{arr(tags)},{closes_sql},now() - interval '{published} days')")
        out.append("INSERT INTO job_posts (company_id,slug,title,description,work_type,department,location,career_level,salary_range,headcount,responsibilities,requirements,preferred,hiring_process,tags,closes_at,published_at) VALUES\n" + ",\n".join(rows))
        out.append("ON CONFLICT (company_id,slug) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, work_type=EXCLUDED.work_type, department=EXCLUDED.department, location=EXCLUDED.location, career_level=EXCLUDED.career_level, salary_range=EXCLUDED.salary_range, headcount=EXCLUDED.headcount, responsibilities=EXCLUDED.responsibilities, requirements=EXCLUDED.requirements, preferred=EXCLUDED.preferred, hiring_process=EXCLUDED.hiring_process, tags=EXCLUDED.tags, closes_at=EXCLUDED.closes_at, published_at=EXCLUDED.published_at;")
        mine = [p for p in people if p["company"] is c]
        rows = []
        for p in mine:
            app_id = f"00000000-0000-4000-8000-0000a{p['serial']:07d}"
            rows.append(f"({q(app_id)},{q(cid)},(SELECT id FROM job_posts WHERE company_id={q(cid)} AND slug={q(p['job_slug'])}),{q(p['receipt'])},'seed:no-deletion-secret','seed',{q(p['name'])},{q(p['email'])},{q(p['phone'])},{q(p['birth'])}::date,{q(p['address'])},{q(p['education'])},{p['years']},{q(p['employer'])},{q(p['summary'])},{q(p['status'])}::application_status,'2026-10-synthetic',now() - interval '{p['hours_ago']} hours',now() - interval '{p['hours_ago']} hours')")
        out.append("INSERT INTO applications (id,company_id,job_post_id,receipt_number,deletion_secret_hash,deletion_secret_pepper_version,applicant_name,applicant_email,applicant_phone,applicant_birth_date,applicant_address,education,career_years,current_company,career_summary,status,privacy_notice_version,notice_acknowledged_at,created_at) VALUES\n" + ",\n".join(rows))
        out.append("ON CONFLICT DO NOTHING;")
        out.append("INSERT INTO receipt_routes (receipt_number,company_id) VALUES " + ",".join(f"({q(p['receipt'])},{q(cid)})" for p in mine) + " ON CONFLICT DO NOTHING;")
        out.append("COMMIT;")
    out.append("RESET ROLE;")
    print("\n".join(out))


if __name__ == "__main__":
    main()
