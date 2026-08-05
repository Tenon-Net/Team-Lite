import React from "react"
export const BaseButton: React.FC<Record<string, any>> = (props) => <button type="button" {...props} />
export const AionSearchInput: React.FC<Record<string, any>> = (props) => <input {...props} />
export const AionInlineSearchInput: React.FC<Record<string, any>> = (props) => <input {...props} />
export default { BaseButton, AionSearchInput, AionInlineSearchInput }
