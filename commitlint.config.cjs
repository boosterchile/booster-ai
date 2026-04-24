/**
 * Conventional Commits — bloqueante en pre-commit via husky.
 * Ref: https://www.conventionalcommits.org/
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // nueva funcionalidad
        'fix', // bug fix
        'docs', // solo documentación
        'style', // formatting, sin cambio de código
        'refactor', // cambio de código sin añadir feature ni fix
        'perf', // mejora de performance
        'test', // añadir/editar tests
        'build', // build system / deps
        'ci', // CI config
        'chore', // mantenimiento
        'revert', // revert de commit previo
        'security', // fix de seguridad
      ],
    ],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
  },
};
