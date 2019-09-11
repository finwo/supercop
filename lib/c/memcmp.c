#ifndef __MEMCMP_C__
#define __MEMCMP_C__

int memcmp (const void *str1, const void *str2, int count) {
  const unsigned char *s1 = str1;
  const unsigned char *s2 = str2;

  while (count-- > 0)
    {
      if (*s1++ != *s2++)
        return s1[-1] < s2[-1] ? -1 : 1;
    }
  return 0;
}

#endif // __MEMCMP_C__
