"""Base controller providing common utility methods for handling queries and params."""


class BaseController:
    @staticmethod
    def get_query_param(query_params, key, default=""):
        return (query_params.get(key) or [default])[0].strip()
