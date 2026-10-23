import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('BAYYINAH_DJANGO_SECRET_KEY')
if not SECRET_KEY:
    raise ImproperlyConfigured(
        'Set BAYYINAH_DJANGO_SECRET_KEY in the environment before starting Django.'
    )

DEBUG = True
ALLOWED_HOSTS = []

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'accounts',
    'workspace',
    'goals',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
]

ROOT_URLCONF = 'bayyinah_backend.urls'
WSGI_APPLICATION = 'bayyinah_backend.wsgi.application'
ASGI_APPLICATION = 'bayyinah_backend.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('BAYYINAH_DB_NAME', 'Bayyinah'),
        'USER': os.environ.get('BAYYINAH_DB_USER', 'postgres'),
        'PASSWORD': os.environ.get('BAYYINAH_DB_PASSWORD', ''),
        'HOST': os.environ.get('BAYYINAH_DB_HOST', 'localhost'),
        'PORT': os.environ.get('BAYYINAH_DB_PORT', '5432'),
        'CONN_MAX_AGE': 60,
    }
}

CORS_ALLOW_ALL_ORIGINS = True

EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ.get('BAYYINAH_EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('BAYYINAH_EMAIL_APP_PASSWORD', '')
DEFAULT_FROM_EMAIL = EMAIL_HOST_USER

BAYYINAH_FRONTEND_URL = os.environ.get(
    'BAYYINAH_FRONTEND_URL',
    'http://127.0.0.1:5173',
).rstrip('/')

AUTH_USER_MODEL = 'accounts.User'
AUTHENTICATION_BACKENDS = ['accounts.authentication.CaseInsensitiveEmailBackend']

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
    {
        'NAME': 'accounts.password_validators.UppercaseValidator',
    },
    {
        'NAME': 'accounts.password_validators.NumberValidator',
    },
]
PASSWORD_RESET_TIMEOUT = 259200

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
}

SIMPLE_JWT = {
    'USER_ID_FIELD': 'user_id',
}
