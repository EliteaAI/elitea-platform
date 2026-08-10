// The member-expression spelling eslint/no-restricted-globals cannot see —
// this is exactly how the SharePoint OAuth token store escaped the §5.4 fence
// and survived logout (issue #22).
export function saveToken(value: string): void {
  window.sessionStorage.setItem('mcp_oauth_tokens', value);
}
