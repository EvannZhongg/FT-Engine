!macro customUnInstallSection
  Section /o "un.Delete local data / 删除本地数据"
    ${ifNot} ${isUpdated}
      RMDir /r "$APPDATA\${PRODUCT_NAME}\match_data"
      Delete "$APPDATA\${PRODUCT_NAME}\app_settings.json"
      RMDir /r "$APPDATA\${PRODUCT_NAME}\logs"
      RMDir "$APPDATA\${PRODUCT_NAME}"
    ${endIf}
  SectionEnd
!macroend
