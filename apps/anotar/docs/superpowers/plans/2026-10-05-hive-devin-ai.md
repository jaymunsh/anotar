# Hive·Devin AI 설정과 요청 UX Implementation Plan

> **For agentic workers:** superpowers:executing-plans로 같은 작업 공간에서 순차 구현한다. 기존 변경과 사용자 데이터는 보존한다.

**Goal:** Hive 기본·Devin 선택을 서버 설정과 요청 UI에 연결하고, 결과를 먼저 읽는 화면을 제공한다.
**Architecture:** 등록된 실행 프로필·서버 SQLite 설정·불변 요청 실행 사본을 사용한다. 기존 단일 worker·Devin 격리·동기화 workflow를 재사용한다.
**Tech Stack:** Node 24, SQLite, React, 기존 테마 CSS, fetch/SSE.
**Spec:** docs/AI_UX_REVIEW.md, docs/AI_RUNNER_PROPOSAL.md. 사용자가 2026-10-05 로컬 반영 진행을 승인했으며 Oracle 반영은 이후 수행한다.

## Global Constraints

- Hive 기본 + Devin CLI 선택. 기존 HTTP 게이트웨이 호환 보존.
- 키·인증 파일은 서버에만 보관. 클라이언트는 실행 경로·셸 인자·API endpoint를 지정하지 않는다.
- 한 번에 작업 1개. 실패 시 다른 실행기로 자동 전환 없음.
- 실행기·모델은 제출 시 사본 저장. 요청 UUID 재전송·offline workflow·재시도 이력 유지.
- PC/390/320 라이트·다크 검증. 원본·결과·첨부 경계 유지.

## Review Focus

- 제출 응답 유실 후 설정 변경에도 같은 UUID의 작업이 재실행/변경되지 않는가.
- Hive SSE가 분할되거나 중간에 끊겼을 때 미완성 응답을 완료로 저장하지 않는가.
- 실제 모델/설정되지 않은 인증을 연결 완료로 표시하지 않는가.
- 기존 페이지·메모 요청과 샘플·휴지통 복구가 호환되는가.
- 결과 중심 화면의 원문 편집·페이지 채택과 모바일 초점/스크롤이 작동하는가.

## Tasks

- [x] Hive adapter, 실패·취소·SSE fixture 테스트.
- [x] SQLite AI 설정·등록 프로필·요청 사본·worker routing, 원자적 replay 테스트.
- [x] 설정 AI 패널과 요청 모델 선택·초안/전송 사본.
- [x] 결과 중심 상세·접는 원문/추가 설정·목록 실행 정보.
- [x] 기존 여행 AI 기본 템플릿 보관(과거 요청 유지), 문서·배포 환경 업데이트.
- [x] 관련 테스트·빌드·임시 DB 브라우저 검증·코드 리뷰.

## 실행 기록

Hive fixture RED→GREEN, 불변 모델/설정 5개 테스트, 전체 425개 통과. 빌드·임시 DB UI·기존 HTTP 메모 smoke·페이지 AI 응답 유실/반영/undo/충돌 QA 통과. 코드 리뷰 Important 2개는 도구 응답 거절과 과거 모델 재시도 재현 후 수정. Oracle 배포는 사용자 요청에 따라 이후 단계. 보고서: `.omo/evidence/hive-devin/REPORT.md`. 기존 dirty workspace는 commit/reset 없이 보존했다.
