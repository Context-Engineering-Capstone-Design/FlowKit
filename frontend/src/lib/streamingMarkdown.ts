/** 아직 다 오지 않은 마크다운을 그릴 때 깨지지 않도록 임시로 손본다 (문서 C4).
 *
 * 지금은 가장 눈에 띄게 깨지는 경우만 다룬다: 코드 울타리(```)가 홀수 번 나오면
 * 닫는 울타리 없이 렌더링돼 그 뒤의 모든 줄이 코드 블록 안으로 말려든다.
 * 완성된 본문(생성이 끝난 블록)에는 적용하지 않는다 — 그건 이미 온전하다.
 */
export function closeUnterminatedMarkdown(text: string): string {
  const fenceCount = (text.match(/```/g) ?? []).length
  if (fenceCount % 2 === 1) {
    return `${text}\n\`\`\``
  }
  return text
}
