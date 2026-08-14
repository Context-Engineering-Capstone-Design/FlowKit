/** 목록에 한 줄로 보여줄 때 쓰는 미리보기.
 *
 * 본문은 마크다운이라 그대로 두면 `**`, `#` 같은 기호가 그대로 보인다.
 */
export function toPreview(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' 코드 ')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
