package com.privatechat.service;

import com.privatechat.dto.ContactDTO;
import java.util.List;

public interface ContactService {
    List<ContactDTO> getContacts(Long userId);
}
