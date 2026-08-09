import { beforeEach, describe, expect, it, vi } from "vitest";

import { detectPageInformation, detectPageInformationWithQr, findTotpQrTargets, scanTotpQrCodes, scanTotpQrTarget } from "./page-information-capture";

describe("active page information capture", () => {
  beforeEach(() => {
    document.head.innerHTML = "<title>Test page</title>";
    document.body.innerHTML = "";
  });

  it("recognizes generated identity, login, and card information from meiguodizhi.com", () => {
    const expirationYear = new Date().getFullYear() + 5;
    document.body.innerHTML = `
      <input class="data_Full_Name" value="Ada Byron Lovelace">
      <input class="data_Birthday" value="12/10/1815">
      <input class="data_Address" value="123 Example Street">
      <input class="data_City" value="New York">
      <input class="data_State_Full" value="New York">
      <input class="data_Zip_Code" value="10001">
      <input class="data_Telephone" value="212-555-0100">
      <input class="data_Temporary_mail" value="ada@example.test">
      <input class="data_Company_Name" value="Analytical Engines">
      <input class="data_Occupation" value="Mathematician">
      <input class="data_Website" value="https://example.test/ada">
      <input class="data_Username" value="ada">
      <input class="data_Password" value="generated-password">
      <input class="data_Credit_Card_Number" value="4111 1111 1111 1111">
      <input class="data_CVV2" value="123">
      <input class="data_Expires" value="12/${expirationYear}">
      <input class="data_Social_Security_Number" value="111-22-3333">
      <input class="data_Security_Question" value="Question">
      <input class="data_Security_Answer" value="Answer">
    `;

    const result = detectPageInformation(document, "https://www.meiguodizhi.com/?key=test");

    expect(result?.data.identity).toMatchObject({
      title: "Ada Byron Lovelace",
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
      birthDate: "1815-12-10",
      organization: "Analytical Engines",
      jobTitle: "Mathematician",
      addresses: [{ city: "New York", region: "New York", postalCode: "10001", countryCode: "US" }],
    });
    expect(result?.data.login).toMatchObject({ username: "ada", password: "generated-password" });
    expect(result?.data.card).toMatchObject({
      cardholderName: "Ada Byron Lovelace",
      cardNumber: "4111111111111111",
      expirationMonth: 12,
      expirationYear,
      securityCode: "123",
    });
    expect(result?.ignoredSensitiveFields).toEqual([]);
    expect(result?.data.secrets?.map((secret) => secret.title)).toEqual(["社会安全号", "安全问题与答案"]);
  });

  it("falls back to generic form semantics on other sites", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="given-name" value="Grace">
        <input autocomplete="family-name" value="Hopper">
        <input autocomplete="address-line1" value="1 Navy Way">
        <input autocomplete="address-level2" value="Arlington">
        <input autocomplete="address-level1" value="VA">
        <input autocomplete="postal-code" value="22201">
        <input autocomplete="country" value="US">
      </form>
    `;

    expect(detectPageInformation(document, "https://example.test/profile")?.data.identity).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      addresses: [{ addressLine1: "1 Navy Way", city: "Arlington", region: "VA", postalCode: "22201", countryCode: "US" }],
    });
  });

  it("captures multiple emails, phones, and addresses from one profile page", () => {
    document.body.innerHTML = `
      <input autocomplete="given-name" value="Ada"><input autocomplete="family-name" value="Lovelace">
      <input autocomplete="email" value="ada@example.test"><input aria-label="Secondary email" value="work@example.test">
      <input autocomplete="tel" value="+1 212 555 0100"><input aria-label="Mobile phone" value="+1 917 555 0101">
      <fieldset><legend>Home address</legend><input autocomplete="address-line1" value="1 Home St"><input autocomplete="address-level2" value="London"></fieldset>
      <fieldset><legend>Work address</legend><input autocomplete="address-line1" value="2 Work Rd"><input autocomplete="address-level2" value="Oxford"></fieldset>
    `;

    const identity = detectPageInformation(document, "https://example.test/profile")?.data.identity;
    expect(identity?.emails.map((entry) => entry.value)).toEqual(["ada@example.test", "work@example.test"]);
    expect(identity?.phones.map((entry) => entry.value)).toEqual(["+1 212 555 0100", "+1 917 555 0101"]);
    expect(identity?.addresses.map((entry) => entry.addressLine1)).toEqual(["1 Home St", "2 Work Rd"]);
  });

  it("returns null when the page has no saveable information", () => {
    document.body.innerHTML = '<input type="search" placeholder="Search">';
    expect(detectPageInformation(document, "https://example.test/")).toBeNull();
  });

  it("recognizes GitHub personal access tokens by their documented prefixes", () => {
    const token = "github_pat_A1b2C3d4E5f6G7h8I9j0K1l2M3n4";
    document.head.innerHTML = "<title>New personal access token</title>";
    document.body.innerHTML = `<label>Personal access token<input readonly value="${token}"></label>`;

    expect(detectPageInformation(document, "https://github.com/settings/personal-access-tokens/new")?.data.secrets?.[0]).toEqual({
      title: "GitHub 访问令牌",
      kind: "access-token",
      secret: token,
      provider: "GitHub",
      account: null,
      environment: null,
      scopes: [],
      expiresAt: null,
      website: "https://github.com/settings/personal-access-tokens/new",
    });
  });

  it("recognizes an access token whose heading is above nested input wrappers", () => {
    const token = "aB3dE6gH9jK2mN5qR8tV1xZ4cF7iL0oP";
    document.body.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="layout">
            <div class="details">
              <h6>系统访问令牌</h6>
              <span>用于 API 调用的身份验证令牌，请妥善保管</span>
              <div class="field-spacing">
                <div class="input-wrapper">
                  <span aria-label="key"></span>
                  <input readonly type="text" value="${token}">
                </div>
              </div>
            </div>
            <button type="button">重新生成</button>
          </div>
        </div>
      </div>
    `;

    expect(detectPageInformation(document, "https://console.example.test/access-token")?.data.secrets?.[0]).toMatchObject({
      kind: "access-token",
      secret: token,
      provider: "console.example.test",
    });
  });

  it("recognizes high-entropy client secrets only when the surrounding label is explicit", () => {
    const value = "aB9dE2gH5jK8mN1qR4tW7yZ0";
    document.body.innerHTML = `<label>OAuth client ID<input readonly value="client-1234567890"></label><label>OAuth client secret<input readonly value="${value}"></label>`;
    expect(detectPageInformation(document, "https://console.example.test/oauth")?.data.secrets?.[0]).toMatchObject({
      kind: "client-secret",
      secret: value,
      provider: "console.example.test",
      account: "client-1234567890",
    });

    document.body.innerHTML = `<input readonly value="${value}">`;
    expect(detectPageInformation(document, "https://console.example.test/oauth")).toBeNull();
  });

  it("recognizes SSH public and private key material as an SSH credential", () => {
    document.body.innerHTML = `
      <textarea aria-label="SSH private key">-----BEGIN OPENSSH PRIVATE KEY-----
private-material-1234567890
-----END OPENSSH PRIVATE KEY-----</textarea>
      <textarea aria-label="SSH public key">ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGeneratedMaterial1234567890 deploy@example.test</textarea>
    `;

    expect(detectPageInformation(document, "https://cloud.example.test/keys/new")?.data.sshCredentials?.[0]).toMatchObject({
      title: "cloud.example.test SSH 密钥",
      host: null,
      port: 22,
      publicKey: expect.stringContaining("ssh-ed25519"),
      privateKey: expect.stringContaining("BEGIN OPENSSH PRIVATE KEY"),
    });
  });

  it("rejects documentation placeholders instead of saving them as real secrets", () => {
    document.head.innerHTML = "<title>API documentation</title>";
    document.body.innerHTML = "<code>github_pat_YOUR_TOKEN_HERE_xxxxxxxxxxxxxxxxxxxx</code>";
    expect(detectPageInformation(document, "https://docs.example.test/auth")).toBeNull();
  });

  it("attaches TOTP, identifiers, and additional login URLs to a recognized login", () => {
    document.body.innerHTML = `
      <label>Username<input autocomplete="username" value="ada"></label>
      <label>Password<input type="password" autocomplete="current-password" value="correct horse battery staple"></label>
      <label>TOTP secret<input value="otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example"></label>
      <label>Client ID<input value="client-123456"></label>
      <label>Additional URL<input value="https://login.example.test/account"></label>
    `;

    const result = detectPageInformation(document, "https://example.test/login");
    expect(result?.data.login).toMatchObject({
      username: "ada",
      totpSecret: "otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example",
      additionalUrls: ["https://login.example.test/account"],
      customFields: [{ label: "Client ID", value: "client-123456" }],
    });
    expect(result?.data.secrets).toEqual([]);
  });

  it("decodes an otpauth URI from a QR image for attaching to a selected login", async () => {
    const previous = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      async detect() { return [{ rawValue: "otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example" }]; }
    };
    document.body.innerHTML = '<img src="data:image/png;base64,AA==" alt="Authenticator QR code">';
    try {
      expect(await scanTotpQrCodes(document)).toEqual([{
        uri: "otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        issuer: "Example",
        account: "ada",
      }]);
      expect(await detectPageInformationWithQr(document, "https://example.test/2fa")).toBeNull();
    } finally {
      (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = previous;
    }
  });

  it("discovers a GitHub-style dynamic QR only after a visible image replaces the hidden loading placeholder", async () => {
    const previous = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      async detect(source: Element) {
        return [{ rawValue: source.id === "first"
          ? "otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
          : "otpauth://totp/Other:grace?secret=KRUGS4ZANFZSAYJA&issuer=Other" }];
      }
    };
    document.body.innerHTML = `
      <div data-target="two-factor-setup-verification.qrCodePlaceholder" hidden>
        <div class="qr-code-img"><svg aria-label="Loading QR code"></svg></div>
      </div>
      <div class="authenticator-qr"><img id="first" src="data:image/png;base64,AA=="></div>
      <div class="authenticator-qr"><img id="second" src="data:image/png;base64,AA=="></div>
    `;
    try {
      const targets = findTotpQrTargets(document);
      expect(targets.map((target) => target.id)).toEqual(["first", "second"]);
      expect(await scanTotpQrTarget(document, targets[0]!)).toEqual([{
        uri: "otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
        issuer: "GitHub",
        account: "ada",
      }]);
      expect(await scanTotpQrTarget(document, targets[1]!)).toEqual([{
        uri: "otpauth://totp/Other:grace?secret=KRUGS4ZANFZSAYJA&issuer=Other",
        issuer: "Other",
        account: "grace",
      }]);
      document.querySelector(".authenticator-qr")!.setAttribute("hidden", "");
      expect(findTotpQrTargets(document).map((target) => target.id)).toEqual(["second"]);
    } finally {
      (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = previous;
    }
  });

  it("discovers and decodes a path-based inline SVG QR without metadata hints", async () => {
    const previous = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const detect = vi.fn(async (source: Element) => source instanceof SVGSVGElement
      ? [{ rawValue: "otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example" }]
      : []);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect = detect;
    };
    document.body.innerHTML = `
      <svg id="inline-qr" width="200" height="200" viewBox="0 0 33 33" class="border">
        <path fill="#fff" d="M0 0h33v33H0z" shape-rendering="crispEdges"></path>
        <path fill="#000" d="${"M0 0h7v1H0z".repeat(10)}" shape-rendering="crispEdges"></path>
      </svg>
    `;
    try {
      const target = document.querySelector("svg")!;
      expect(findTotpQrTargets(document)).toEqual([target]);
      expect(await scanTotpQrTarget(document, target)).toEqual([{
        uri: "otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        issuer: "Example",
        account: "ada",
      }]);
      expect(detect).toHaveBeenCalledWith(target);
    } finally {
      (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = previous;
    }
  });

  it("rejects unsupported TOTP profiles decoded from a target QR", async () => {
    const previous = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      async detect() { return [{ rawValue: "otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&digits=8" }]; }
    };
    document.body.innerHTML = '<img id="qr" src="data:image/png;base64,AA==" alt="Authenticator QR code">';
    try {
      expect(await scanTotpQrTarget(document, document.querySelector("img")!)).toEqual([]);
    } finally {
      (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = previous;
    }
  });

  it("attaches a scanned QR code to a recognized login instead of creating a standalone secret", async () => {
    document.body.innerHTML = `
      <input autocomplete="username" value="ada">
      <input type="password" autocomplete="current-password" value="correct horse battery staple">
      <a href="otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&amp;issuer=Example">Set up authenticator</a>
    `;

    const result = await detectPageInformationWithQr(document, "https://example.test/2fa");
    expect(result?.data.login?.totpSecret).toBe("otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    expect(result?.data.secrets).toEqual([]);
  });

  it("recognizes multiple tokens with scopes and expiration metadata", () => {
    document.body.innerHTML = `
      <section><label>API key<input value="sk-proj-A1b2C3d4E5f6G7h8I9j0K1L2"></label><label>Scopes<input value="models:read, files:write"></label><label>Expires<input value="2030-12-31"></label></section>
      <section><label>Access token<input value="github_pat_Z1y2X3w4V5u6T7s8R9q0P1o2N3m4"></label></section>
    `;

    const secrets = detectPageInformation(document, "https://github.com/settings/tokens")?.data.secrets;
    expect(secrets).toHaveLength(2);
    expect(secrets?.[0]).toMatchObject({ scopes: ["models:read", "files:write"], expiresAt: "2030-12-31" });
  });

  it("recognizes database URLs, JWTs, service-account JSON, licenses, webhooks, recovery codes, certificates, and wallet phrases", () => {
    const serviceAccount = JSON.stringify({ type: "service_account", project_id: "project-a", client_email: "bot@example.test", private_key: "private-material" });
    document.body.innerHTML = `
      <label>Database connection string<textarea>postgresql://ada:secret@db.example.test:5432/app</textarea></label>
      <label>Bearer JWT<textarea>eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.signature123456</textarea></label>
      <label>Service account JSON<textarea>${serviceAccount}</textarea></label>
      <label>Software license key<input value="AAAAA-BBBBB-CCCCC-DDDDD"></label>
      <label>Webhook URL<input value="https://hooks.example.test/services/abc123/secret456"></label>
      <label>Recovery codes<textarea>alpha-1234\nbeta-5678\ngamma-9012</textarea></label>
      <label>TLS certificate<textarea>-----BEGIN CERTIFICATE-----\ncertificate-material-123456\n-----END CERTIFICATE-----</textarea></label>
      <label>Wallet seed phrase<textarea>alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima</textarea></label>
    `;

    const recognized = detectPageInformation(document, "https://console.example.test/credentials")?.data.secrets;
    const titles = recognized?.map((secret) => secret.title);
    expect(titles).toEqual(expect.arrayContaining([
      "console.example.test 数据库连接串", "console.example.test JWT", "console.example.test 服务账号 JSON",
      "console.example.test 软件许可证", "console.example.test Webhook 地址", "console.example.test 恢复码",
      "console.example.test 证书或 PEM 密钥", "console.example.test 钱包助记词（高风险）",
    ]));
    expect(recognized?.map((secret) => secret.kind)).toEqual(expect.arrayContaining([
      "database-credential", "access-token", "client-secret", "software-license", "webhook-secret",
      "recovery-codes", "certificate", "crypto-wallet",
    ]));
  });

  it("recognizes SSH connection metadata and card extras", () => {
    const year = new Date().getFullYear() + 2;
    document.body.innerHTML = `
      <section>
        <label>SSH host<input value="server.example.test"></label><label>SSH port<input value="2222"></label>
        <label>SSH username<input value="deploy"></label><label>SSH key passphrase<input value="passphrase-value"></label>
        <label>SSH private key<textarea>-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-material-1234567890\n-----END OPENSSH PRIVATE KEY-----</textarea></label>
      </section>
      <label>Cardholder<input autocomplete="cc-name" value="Ada Lovelace"></label>
      <label>Card number<input autocomplete="cc-number" value="4111 1111 1111 1111"></label>
      <input autocomplete="cc-exp-month" value="12"><input autocomplete="cc-exp-year" value="${year}">
      <label>Card PIN<input value="1234"></label><label>Issuing bank<input value="Example Bank"></label>
    `;

    const data = detectPageInformation(document, "https://cloud.example.test/credentials")?.data;
    expect(data?.sshCredentials?.[0]).toMatchObject({ host: "server.example.test", port: 2222, username: "deploy", keyPassphrase: "passphrase-value" });
    expect(data?.card).toMatchObject({ pin: "1234", issuer: "Example Bank", network: "Visa" });
  });

  it("does not capture session cookies, CSRF tokens, or OAuth authorization codes", () => {
    document.body.innerHTML = `
      <label>Session cookie<input value="session-A1b2C3d4E5f6G7h8I9j0"></label>
      <label>CSRF token<input value="csrf-A1b2C3d4E5f6G7h8I9j0"></label>
      <label>OAuth authorization code<input value="oauth-A1b2C3d4E5f6G7h8I9j0"></label>
    `;
    expect(detectPageInformation(document, "https://example.test/callback")).toBeNull();
  });

  it("recognizes identity-document values and secure notes even when they are short or numeric", () => {
    document.body.innerHTML = `
      <label>Passport number<input value="E12345678"></label>
      <label>Security answer<input value="Lovelace"></label>
    `;
    expect(detectPageInformation(document, "https://identity.example.test/profile")?.data.secrets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "identity-document", secret: "E12345678" }),
      expect.objectContaining({ kind: "secure-note", secret: "Lovelace" }),
    ]));
  });
});
