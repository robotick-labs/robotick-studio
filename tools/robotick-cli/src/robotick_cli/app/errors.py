class CliError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "cli_error",
        recovery: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.recovery = recovery


class HubUnavailableError(CliError):
    pass


class HubRequestError(CliError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        payload: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload
