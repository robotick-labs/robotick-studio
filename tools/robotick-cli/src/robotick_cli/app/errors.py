class CliError(Exception):
    pass


class HubUnavailableError(CliError):
    pass


class HubRequestError(CliError):
    pass
