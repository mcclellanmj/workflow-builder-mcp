import type { VNode } from "preact";
import { Button } from "../components/Button.tsx";
import { Input } from "../components/Input.tsx";
import { Badge } from "../components/Badge.tsx";

export interface PasskeyDevice {
  id: string;
  deviceType?: string;
  createdAt?: string;
}

export interface PasskeyAuthProps {
  isAuthenticated?: boolean;
  username?: string;
  userId?: string;
  passkeys?: PasskeyDevice[];
  onSignIn?: () => void;
  onRegister?: () => void;
  onAddPasskey?: () => void;
  onDeletePasskey?: (credentialId: string) => void;
  class?: string;
  className?: string;
}

/**
 * WebAuthn Passkey registration & login card with username input,
 * register button, login button, and status output area.
 */
export function PasskeyAuth({
  isAuthenticated = false,
  passkeys = [],
  onSignIn,
  onRegister,
  onAddPasskey,
  onDeletePasskey,
  class: classProp,
  className,
}: PasskeyAuthProps): VNode {
  const customClass = classProp || className || "";

  return (
    <div
      id="passkeyAuthCard"
      class={`bg-gray-800/80 backdrop-blur-sm border border-gray-700/80 rounded-xl p-6 shadow-lg flex flex-col gap-6 ${customClass}`
        .trim()}
    >
      {/* Card Header */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-700/60 pb-4">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-2xl" aria-hidden="true">🔐</span>
            <h2 class="text-lg font-semibold text-gray-100 tracking-tight">
              Biometric Hardware Authentication
            </h2>
            <Badge variant="closed" size="sm">Passkey / WebAuthn</Badge>
          </div>
          <p class="text-xs text-gray-400 mt-1">
            FIDO2 / WebAuthn biometric security using Touch ID, Face ID, or Windows Hello.
          </p>
        </div>
      </div>

      {/* Status Alert Output Area */}
      <div
        id="alertBox"
        role="alert"
        class="hidden p-3.5 rounded-lg text-sm font-medium transition-all duration-200"
      />

      {/* Unauthenticated Mode: Sign In or Register Tabs */}
      <div id="authSection" class={isAuthenticated ? "hidden" : "flex flex-col gap-5"}>
        {/* Tab Buttons */}
        <div class="flex items-center border-b border-gray-700">
          <button
            type="button"
            id="tabLoginBtn"
            class="px-4 py-2 text-sm font-semibold border-b-2 border-blue-500 text-blue-400 focus:outline-none transition-colors"
          >
            🔑 Sign In with Passkey
          </button>
          <button
            type="button"
            id="tabRegisterBtn"
            class="px-4 py-2 text-sm font-semibold border-b-2 border-transparent text-gray-400 hover:text-gray-200 focus:outline-none transition-colors"
          >
            ✨ Create New Passkey
          </button>
        </div>

        {/* Login Form Panel */}
        <div id="loginTab" class="flex flex-col gap-4">
          <p class="text-xs text-gray-300">
            Touch your fingerprint sensor, Face ID, or security key to sign in instantly.
          </p>
          <Input
            id="loginUsername"
            name="username"
            label="Username (Optional for hardware auto-discovery)"
            placeholder="e.g. alice (or leave blank for Passkey prompt)"
            type="text"
          />
          <div>
            <Button
              id="btnSignInPasskey"
              variant="primary"
              size="md"
              onClick={onSignIn}
              class="w-full sm:w-auto"
            >
              <span class="mr-1.5" aria-hidden="true">👆</span>
              Sign In with Biometrics / Passkey
            </Button>
          </div>
        </div>

        {/* Register Form Panel */}
        <div id="registerTab" class="hidden flex flex-col gap-4">
          <p class="text-xs text-gray-300">
            Register a new hardware Passkey tied directly to your secure enclave (no passwords).
          </p>
          <Input
            id="regUsername"
            name="username"
            label="Choose a Username"
            placeholder="e.g. alice"
            type="text"
            required
          />
          <div>
            <Button
              id="btnRegisterPasskey"
              variant="primary"
              size="md"
              onClick={onRegister}
              class="w-full sm:w-auto"
            >
              <span class="mr-1.5" aria-hidden="true">🔐</span>
              Create Passkey with Touch ID / Face ID
            </Button>
          </div>
        </div>
      </div>

      {/* Authenticated Mode: Passkey Management */}
      <div
        id="dashboardSection"
        class={isAuthenticated ? "flex flex-col gap-5" : "hidden flex flex-col gap-5"}
      >
        <div class="flex items-center justify-between border-b border-gray-700/60 pb-3">
          <div>
            <h3 class="text-sm font-semibold text-gray-200">
              Registered Hardware Devices
            </h3>
            <p class="text-xs text-gray-400 mt-0.5">
              Passkeys and biometric authenticators registered to this account.
            </p>
          </div>
          <Button
            id="btnAddPasskey"
            variant="secondary"
            size="sm"
            onClick={onAddPasskey}
          >
            <span>➕</span> Add This Device
          </Button>
        </div>

        {/* Passkeys List */}
        <div id="passkeysListContainer" class="min-h-[60px]">
          <ul id="passkeysList" class="flex flex-col gap-2 list-none p-0 m-0">
            {passkeys.length === 0
              ? (
                <li class="text-xs text-gray-400 italic py-2">
                  Loading registered credentials...
                </li>
              )
              : (
                passkeys.map((p, idx) => (
                  <li
                    key={p.id}
                    class="flex items-center justify-between p-3 bg-gray-900/70 border border-gray-700/70 rounded-lg text-xs"
                  >
                    <div class="flex flex-col gap-0.5">
                      <span class="font-medium text-gray-200">
                        🔑 Passkey #{idx + 1}{" "}
                        <span class="text-gray-400 font-normal">
                          ({p.deviceType || "platform"})
                        </span>
                      </span>
                      <span class="font-mono text-gray-400 text-[11px]">
                        {p.id.slice(0, 12)}...{p.id.slice(-6)}
                      </span>
                    </div>
                    {passkeys.length > 1 && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => onDeletePasskey?.(p.id)}
                        data-credential-id={p.id}
                        class="btn-delete-passkey"
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))
              )}
          </ul>
        </div>
      </div>
    </div>
  );
}
