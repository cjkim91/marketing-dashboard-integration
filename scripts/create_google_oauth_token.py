#!/usr/bin/env python3
"""
Create a Google OAuth refresh token for GA4 Data API scheduled pulls.

Usage:
  python scripts/create_google_oauth_token.py \
    --client-secrets /absolute/path/to/oauth-client.json
"""

import argparse
import json
import sys


SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Google OAuth refresh token.")
    parser.add_argument("--client-secrets", required=True, help="Path to OAuth client JSON.")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print(
            "Missing dependency: google-auth-oauthlib. "
            "Install it with `python -m pip install -r requirements.txt`.",
            file=sys.stderr,
        )
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(args.client_secrets, SCOPES)
    credentials = flow.run_local_server(
        port=args.port,
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )

    client_config = flow.client_config
    output = {
        "GOOGLE_OAUTH_CLIENT_ID": client_config.get("client_id"),
        "GOOGLE_OAUTH_CLIENT_SECRET": client_config.get("client_secret"),
        "GOOGLE_OAUTH_REFRESH_TOKEN": credentials.refresh_token,
        "scopes": list(credentials.scopes or SCOPES),
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))

    if not credentials.refresh_token:
        print(
            "Refresh token was not returned. In Google Account permissions, "
            "remove this app access and run again.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
