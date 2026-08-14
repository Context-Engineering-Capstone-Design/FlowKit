/** Google Identity Services 연동.
 *
 * 구글이 제공하는 스크립트를 불러와 공식 로그인 버튼을 그린다. 버튼을 누르면
 * ID 토큰을 받아오고, 그 토큰의 진위 확인은 백엔드가 한다(BE-AUTH-002).
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

interface CredentialResponse {
  credential: string
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string
    callback: (response: CredentialResponse) => void
    auto_select?: boolean
  }) => void
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

let loading: Promise<GoogleAccountsId> | null = null

/** 스크립트를 한 번만 불러온다. 여러 번 부르면 버튼이 중복으로 그려진다. */
function loadScript(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google.accounts.id)
  }
  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      const api = window.google?.accounts?.id
      if (api) resolve(api)
      else reject(new Error('Google 로그인 모듈을 찾을 수 없습니다.'))
    }
    script.onerror = () =>
      reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다.'))
    document.head.appendChild(script)
  })
  return loading
}

export async function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
): Promise<void> {
  const api = await loadScript()

  api.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
  })

  parent.replaceChildren()
  api.renderButton(parent, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    locale: 'ko',
    width: 300,
  })
}
